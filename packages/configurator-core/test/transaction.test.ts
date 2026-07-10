import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createSnapshotBackup,
  recoverInterruptedOperations,
  restoreOperation,
} from '../src/backup.js';
import { atomicWriteFile, pathExists } from '../src/filesystem.js';
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
          },
          {
            clientId: 'test-client',
            path: created,
            content: 'secret\n',
            containsSecret: true,
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
              },
              {
                clientId: 'test-client',
                path: blocked,
                content: 'cannot be written',
                containsSecret: true,
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

  test('recovers a prepared operation left by an interrupted process', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'backups');
    const target = join(root, 'target.json');
    await writeFile(target, 'before');
    const prepared = await createSnapshotBackup(backupRoot, 'configuration', [
      { clientId: 'test-client', targetPath: target },
    ]);
    await atomicWriteFile(target, 'partially-written', 0o600);

    const recovered = await recoverInterruptedOperations({
      backupRoot,
      allowedPaths: [target],
    });
    expect(await readFile(target, 'utf8')).toBe('before');
    expect(recovered.map(({ manifest }) => manifest.id)).toEqual([
      prepared.manifest.id,
    ]);
    expect(recovered[0]!.manifest.status).toBe('rolled-back');
  });
});
