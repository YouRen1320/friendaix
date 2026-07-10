import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createSnapshotBackup,
  recoverInterruptedOperations,
  restoreOperation,
} from '../src/backup.js';
import { atomicWriteFile, pathExists, sha256 } from '../src/filesystem.js';
import { applyConfiguration } from '../src/transaction.js';
import type { AdapterPlan } from '../src/types.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'friendaix-core-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function plan(clientId: string, writes: AdapterPlan['writes']): AdapterPlan {
  return { clientId, clientName: clientId, writes, warnings: [] };
}

describe('configuration transactions', () => {
  test('rejects malformed or cross-client writes before creating a backup', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'backups');
    await expect(
      applyConfiguration(
        [
          plan('declared-client', [
            {
              clientId: 'different-client',
              path: join(root, 'target.json'),
              content: 'content',
              containsSecret: false,
              expected: { existed: false },
            },
          ]),
        ],
        { backupRoot },
      ),
    ).rejects.toThrow(/非法写入计划/);
    expect(await pathExists(backupRoot)).toBe(false);
  });

  test('restores modified files and removes files that were originally absent', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'backups');
    const existing = join(root, 'client', 'existing.json');
    const created = join(root, 'client', 'created.json');
    await mkdir(join(root, 'client'), { recursive: true });
    await writeFile(existing, 'original\n', { mode: 0o644 });

    const backup = await applyConfiguration(
      [
        plan('test-client', [
          {
            clientId: 'test-client',
            path: existing,
            content: 'changed\n',
            containsSecret: false,
            expected: {
              existed: true,
              sha256: sha256(Buffer.from('original\n')),
            },
          },
          {
            clientId: 'test-client',
            path: created,
            content: 'secret\n',
            containsSecret: true,
            expected: { existed: false },
          },
        ]),
      ],
      { backupRoot },
    );

    expect(await readFile(existing, 'utf8')).toBe('changed\n');
    expect(await readFile(created, 'utf8')).toBe('secret\n');
    if (process.platform !== 'win32') {
      expect((await stat(existing)).mode & 0o777).toBe(0o644);
      expect((await stat(created)).mode & 0o777).toBe(0o600);
    }
    expect(backup.manifest.status).toBe('applied');

    const restored = await restoreOperation(backup.directory, {
      backupRoot,
      allowedPaths: [existing, created],
    });
    expect(await readFile(existing, 'utf8')).toBe('original\n');
    expect(await pathExists(created)).toBe(false);
    expect(restored.removed).toEqual([created]);
    expect(restored.safetyBackup.manifest.kind).toBe('restore-safety');
  });

  test.skipIf(process.platform === 'win32')(
    'rolls back earlier writes when a later write fails',
    async () => {
      const root = await temporaryDirectory();
      const backupRoot = join(root, 'backups');
      const first = join(root, 'first.json');
      const lockedDirectory = join(root, 'locked');
      const blocked = join(lockedDirectory, 'blocked.json');
      await import('node:fs/promises').then(({ mkdir }) =>
        mkdir(lockedDirectory, { mode: 0o500 }),
      );

      await expect(
        applyConfiguration(
          [
            plan('test-client', [
              {
                clientId: 'test-client',
                path: first,
                content: 'must be rolled back',
                containsSecret: true,
                expected: { existed: false },
              },
              {
                clientId: 'test-client',
                path: blocked,
                content: 'cannot be written',
                containsSecret: true,
                expected: { existed: false },
              },
            ]),
          ],
          { backupRoot },
        ),
      ).rejects.toThrow(/已回滚/);
      expect(await pathExists(first)).toBe(false);
      await chmod(lockedDirectory, 0o700);
    },
  );

  test('rejects a tampered manifest that escapes its backup directory', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'backups');
    const target = join(root, 'target.json');
    await writeFile(target, 'original');
    const backup = await applyConfiguration(
      [
        plan('test-client', [
          {
            clientId: 'test-client',
            path: target,
            content: 'changed',
            containsSecret: true,
            expected: {
              existed: true,
              sha256: sha256(Buffer.from('original')),
            },
          },
        ]),
      ],
      { backupRoot },
    );
    const manifestPath = join(backup.directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.files[0].backupFile = '../../outside';
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(
      restoreOperation(backup.directory, {
        backupRoot,
        allowedPaths: [target],
      }),
    ).rejects.toThrow(/路径越界/);
    expect(await readFile(target, 'utf8')).toBe('changed');
  });

  test('rejects a restore target outside the caller allowlist', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'backups');
    const target = join(root, 'target.json');
    await writeFile(target, 'original');
    const backup = await applyConfiguration(
      [
        plan('test-client', [
          {
            clientId: 'test-client',
            path: target,
            content: 'changed',
            containsSecret: false,
            expected: {
              existed: true,
              sha256: sha256(Buffer.from('original')),
            },
          },
        ]),
      ],
      { backupRoot },
    );

    await expect(
      restoreOperation(backup.directory, {
        backupRoot,
        allowedPaths: [],
      }),
    ).rejects.toThrow(/未授权路径/);
    expect(await readFile(target, 'utf8')).toBe('changed');
  });

  test('rejects backup content whose SHA-256 no longer matches', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'backups');
    const target = join(root, 'target.json');
    await writeFile(target, 'original');
    const backup = await applyConfiguration(
      [
        plan('test-client', [
          {
            clientId: 'test-client',
            path: target,
            content: 'changed',
            containsSecret: false,
            expected: {
              existed: true,
              sha256: sha256(Buffer.from('original')),
            },
          },
        ]),
      ],
      { backupRoot },
    );
    const backupFile = backup.manifest.files[0]!.backupFile!;
    await writeFile(join(backup.directory, backupFile), 'tampered');

    await expect(
      restoreOperation(backup.directory, {
        backupRoot,
        allowedPaths: [target],
      }),
    ).rejects.toThrow(/校验失败/);
    expect(await readFile(target, 'utf8')).toBe('changed');
  });

  test('rejects duplicate target records in a backup manifest', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'backups');
    const target = join(root, 'target.json');
    await writeFile(target, 'original');
    const backup = await applyConfiguration(
      [
        plan('test-client', [
          {
            clientId: 'test-client',
            path: target,
            content: 'changed',
            containsSecret: false,
            expected: {
              existed: true,
              sha256: sha256(Buffer.from('original')),
            },
          },
        ]),
      ],
      { backupRoot },
    );
    const manifestPath = join(backup.directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.files.push({ ...manifest.files[0] });
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(
      restoreOperation(backup.directory, {
        backupRoot,
        allowedPaths: [target],
      }),
    ).rejects.toThrow(/重复目标路径/);
    expect(await readFile(target, 'utf8')).toBe('changed');
  });

  test.skipIf(process.platform === 'win32')(
    'rejects a symlink substituted for backup content',
    async () => {
      const root = await temporaryDirectory();
      const backupRoot = join(root, 'backups');
      const target = join(root, 'target.json');
      const external = join(root, 'external.json');
      await writeFile(target, 'original');
      await writeFile(external, 'original');
      const backup = await applyConfiguration(
        [
          plan('test-client', [
            {
              clientId: 'test-client',
              path: target,
              content: 'changed',
              containsSecret: false,
              expected: {
                existed: true,
                sha256: sha256(Buffer.from('original')),
              },
            },
          ]),
        ],
        { backupRoot },
      );
      const backupFile = backup.manifest.files[0]!.backupFile!;
      const stored = join(backup.directory, backupFile);
      await rm(stored);
      await symlink(external, stored);

      await expect(
        restoreOperation(backup.directory, {
          backupRoot,
          allowedPaths: [target],
        }),
      ).rejects.toThrow(/只支持普通配置文件/);
      expect(await readFile(target, 'utf8')).toBe('changed');
    },
  );

  test.skipIf(process.platform === 'win32')(
    'rejects a symlink substituted for the backup files directory',
    async () => {
      const root = await temporaryDirectory();
      const backupRoot = join(root, 'backups');
      const target = join(root, 'target.json');
      await writeFile(target, 'original');
      const backup = await applyConfiguration(
        [
          plan('test-client', [
            {
              clientId: 'test-client',
              path: target,
              content: 'changed',
              containsSecret: false,
              expected: {
                existed: true,
                sha256: sha256(Buffer.from('original')),
              },
            },
          ]),
        ],
        { backupRoot },
      );
      const backupName =
        backup.manifest.files[0]!.backupFile!.split('/').at(-1)!;
      const externalDirectory = join(root, 'external-files');
      await mkdir(externalDirectory);
      await writeFile(join(externalDirectory, backupName), 'original');
      await rm(join(backup.directory, 'files'), {
        recursive: true,
        force: true,
      });
      await symlink(externalDirectory, join(backup.directory, 'files'));

      await expect(
        restoreOperation(backup.directory, {
          backupRoot,
          allowedPaths: [target],
        }),
      ).rejects.toThrow(/父路径不是普通目录/);
      expect(await readFile(target, 'utf8')).toBe('changed');
    },
  );

  test('cleans up a partial snapshot when a target is not a regular file', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'backups');
    const directoryTarget = join(root, 'not-a-file');
    await mkdir(directoryTarget);

    await expect(
      createSnapshotBackup(backupRoot, 'configuration', [
        { clientId: 'test-client', targetPath: directoryTarget },
      ]),
    ).rejects.toThrow(/只支持普通配置文件/);
    expect(await readdir(backupRoot)).toEqual([]);
  });

  test('recovers a prepared operation left by an interrupted process', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'backups');
    const target = join(root, 'target.json');
    await writeFile(target, 'before');
    const prepared = await createSnapshotBackup(backupRoot, 'configuration', [
      { clientId: 'test-client', targetPath: target },
    ]);
    await atomicWriteFile(target, 'partially-written', 0o600);
    const orphan = join(
      root,
      `.${basename(target)}.friendaix-12345678-1234-1234-1234-123456789abc.tmp`,
    );
    await writeFile(orphan, 'orphaned-secret', { mode: 0o600 });

    const recovered = await recoverInterruptedOperations({
      backupRoot,
      allowedPaths: [target],
    });
    expect(await readFile(target, 'utf8')).toBe('before');
    expect(await pathExists(orphan)).toBe(false);
    expect(recovered.map(({ manifest }) => manifest.id)).toEqual([
      prepared.manifest.id,
    ]);
    expect(recovered[0]!.manifest.status).toBe('rolled-back');
  });

  test('rejects a stale plan without overwriting the newer file', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'backups');
    const target = join(root, 'target.json');
    await writeFile(target, 'planned-from');
    const stalePlan = plan('test-client', [
      {
        clientId: 'test-client',
        path: target,
        content: 'friendaix-write',
        containsSecret: false,
        expected: {
          existed: true,
          sha256: sha256(Buffer.from('planned-from')),
        },
      },
    ]);
    await writeFile(target, 'newer-external-change');

    await expect(
      applyConfiguration([stalePlan], { backupRoot }),
    ).rejects.toThrow(/计划生成后已变化/);
    expect(await readFile(target, 'utf8')).toBe('newer-external-change');
    const manifests = await import('../src/backup.js').then(({ scanBackups }) =>
      scanBackups(backupRoot),
    );
    expect(manifests).toHaveLength(1);
    expect(manifests[0]!.manifest.status).toBe('rolled-back');
  });
});
