import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { errorMessage } from './errors.js';
import {
  atomicWriteFile,
  cleanupAtomicWriteTemps,
  ensurePrivateDirectory,
  fileMode,
  pathExists,
  readOptionalFileWithExpectation,
  readRegularFile,
  sha256,
} from './filesystem.js';
import type {
  BackupEntry,
  BackupKind,
  BackupManifest,
  FileSnapshot,
  RestoreOptions,
  RestoreResult,
} from './types.js';

const MANIFEST_FILE = 'manifest.json';

interface SnapshotDescriptor {
  clientId: string;
  targetPath: string;
}

interface SnapshotReference {
  directory: string;
  snapshot: FileSnapshot;
}

function createBackupId(kind: BackupKind): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${kind}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function backupName(index: number, targetPath: string): string {
  const safeName = basename(targetPath).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `files/${String(index).padStart(3, '0')}-${safeName}`;
}

function storedBackupPath(directory: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`备份内容路径不能是绝对路径：${relativePath}`);
  }
  const root = resolve(directory);
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`备份内容路径越界：${relativePath}`);
  }
  return candidate;
}

async function assertStoredParents(
  directory: string,
  candidate: string,
): Promise<void> {
  const segments = relative(resolve(directory), candidate).split(sep);
  let current = resolve(directory);
  const root = await lstat(current);
  if (!root.isDirectory())
    throw new Error(`备份目录不是普通目录：${directory}`);
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const metadata = await lstat(current);
    if (!metadata.isDirectory()) {
      throw new Error(`备份内容父路径不是普通目录：${current}`);
    }
  }
}

export async function readSnapshotContent(
  directory: string,
  snapshot: FileSnapshot,
): Promise<Buffer> {
  if (!snapshot.backupFile || !snapshot.sha256) {
    throw new Error(`备份 ${snapshot.targetPath} 缺少内容或校验值。`);
  }
  const candidate = storedBackupPath(directory, snapshot.backupFile);
  await assertStoredParents(directory, candidate);
  const content = await readRegularFile(candidate);
  if (sha256(content) !== snapshot.sha256) {
    throw new Error(`备份 ${snapshot.targetPath} 校验失败，拒绝恢复。`);
  }
  return content;
}

export async function createSnapshotBackup(
  backupRoot: string,
  kind: BackupKind,
  descriptors: SnapshotDescriptor[],
  sourceBackupId?: string,
): Promise<BackupEntry> {
  const seen = new Set<string>();
  for (const descriptor of descriptors) {
    if (!descriptor.clientId || !isAbsolute(descriptor.targetPath)) {
      throw new Error('备份目标必须包含客户端 ID 和绝对路径。');
    }
    const key = resolve(descriptor.targetPath);
    if (seen.has(key)) {
      throw new Error(`备份目标重复：${descriptor.targetPath}`);
    }
    seen.add(key);
  }
  await ensurePrivateDirectory(backupRoot);
  const id = createBackupId(kind);
  const directory = join(backupRoot, id);
  await ensurePrivateDirectory(directory);
  await ensurePrivateDirectory(join(directory, 'files'));

  try {
    const files: FileSnapshot[] = [];
    for (const [index, descriptor] of descriptors.entries()) {
      const current = await readOptionalFileWithExpectation(
        descriptor.targetPath,
      );
      if (!current.content) {
        files.push({ ...descriptor, existed: false });
        continue;
      }

      const relativeBackup = backupName(index, descriptor.targetPath);
      await atomicWriteFile(
        join(directory, relativeBackup),
        current.content,
        0o600,
      );
      files.push({
        ...descriptor,
        existed: true,
        backupFile: relativeBackup,
        originalMode: await fileMode(descriptor.targetPath),
        sha256: current.expectation.sha256,
      });
    }

    const manifest: BackupManifest = {
      schemaVersion: 2,
      id,
      kind,
      createdAt: new Date().toISOString(),
      status: 'prepared',
      clients: [...new Set(descriptors.map((item) => item.clientId))],
      files,
      ...(sourceBackupId ? { sourceBackupId } : {}),
    };
    await writeManifest(directory, manifest);
    return { directory, manifest };
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function markBackup(
  entry: BackupEntry,
  status: BackupManifest['status'],
  error?: string,
): Promise<BackupEntry> {
  const manifest: BackupManifest = {
    ...entry.manifest,
    status,
    ...(error ? { error } : {}),
  };
  await writeManifest(entry.directory, manifest);
  return { directory: entry.directory, manifest };
}

async function writeManifest(
  directory: string,
  manifest: BackupManifest,
): Promise<void> {
  await atomicWriteFile(
    join(directory, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    0o600,
  );
}

export async function readBackup(directory: string): Promise<BackupEntry> {
  const manifestPath = join(directory, MANIFEST_FILE);
  const raw: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${manifestPath} 不是合法备份 manifest。`);
  }
  const manifest = raw as Partial<BackupManifest>;
  if (
    manifest.schemaVersion !== 2 ||
    typeof manifest.id !== 'string' ||
    typeof manifest.createdAt !== 'string' ||
    Number.isNaN(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.clients) ||
    manifest.clients.some(
      (client) => typeof client !== 'string' || client.length === 0,
    ) ||
    (manifest.sourceBackupId !== undefined &&
      typeof manifest.sourceBackupId !== 'string') ||
    (manifest.error !== undefined && typeof manifest.error !== 'string') ||
    (manifest.kind !== 'configuration' && manifest.kind !== 'restore-safety') ||
    !['prepared', 'applied', 'rolled-back'].includes(manifest.status ?? '')
  ) {
    throw new Error(`${manifestPath} 缺少必要字段或版本不受支持。`);
  }
  const seenTargets = new Set<string>();
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file !== 'object' ||
      typeof file.clientId !== 'string' ||
      typeof file.targetPath !== 'string' ||
      !isAbsolute(file.targetPath) ||
      typeof file.existed !== 'boolean' ||
      (file.existed &&
        (typeof file.backupFile !== 'string' ||
          file.backupFile.length === 0 ||
          typeof file.sha256 !== 'string')) ||
      (file.originalMode !== undefined &&
        (!Number.isInteger(file.originalMode) ||
          file.originalMode < 0 ||
          file.originalMode > 0o777))
    ) {
      throw new Error(`${manifestPath} 包含非法文件记录。`);
    }
    const key = resolve(file.targetPath);
    if (seenTargets.has(key)) {
      throw new Error(`${manifestPath} 包含重复目标路径。`);
    }
    seenTargets.add(key);
    if (file.backupFile) storedBackupPath(directory, file.backupFile);
  }
  return { directory, manifest: manifest as BackupManifest };
}

export async function scanBackups(backupRoot: string): Promise<BackupEntry[]> {
  if (!(await pathExists(backupRoot))) return [];
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const backups: BackupEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(backupRoot, entry.name);
    if (!(await pathExists(join(directory, MANIFEST_FILE)))) continue;
    try {
      backups.push(await readBackup(directory));
    } catch {
      // Invalid or partial backup folders remain untouched and are not offered.
    }
  }
  return backups.sort((a, b) =>
    a.manifest.createdAt.localeCompare(b.manifest.createdAt),
  );
}

function assertAllowed(
  references: SnapshotReference[],
  allowedPaths: Iterable<string>,
): void {
  const allowed = new Set([...allowedPaths].map((path) => resolve(path)));
  for (const reference of references) {
    if (!allowed.has(resolve(reference.snapshot.targetPath))) {
      throw new Error(
        `备份请求写入未授权路径，已拒绝：${reference.snapshot.targetPath}`,
      );
    }
  }
}

async function applySnapshotReferences(
  references: SnapshotReference[],
): Promise<{ restored: string[]; removed: string[] }> {
  const restored: string[] = [];
  const removed: string[] = [];
  for (const { directory, snapshot } of references) {
    if (!snapshot.existed) {
      await rm(snapshot.targetPath, { force: true });
      removed.push(snapshot.targetPath);
      continue;
    }
    const content = await readSnapshotContent(directory, snapshot);
    await atomicWriteFile(
      snapshot.targetPath,
      content,
      snapshot.originalMode ?? 0o600,
    );
    restored.push(snapshot.targetPath);
  }
  return { restored, removed };
}

async function restoreReferences(
  references: SnapshotReference[],
  options: RestoreOptions,
  sourceBackupId: string,
): Promise<RestoreResult> {
  assertAllowed(references, options.allowedPaths);
  const safety = await createSnapshotBackup(
    options.backupRoot,
    'restore-safety',
    references.map(({ snapshot }) => ({
      clientId: snapshot.clientId,
      targetPath: snapshot.targetPath,
    })),
    sourceBackupId,
  );

  try {
    const result = await applySnapshotReferences(references);
    const appliedSafety = await markBackup(safety, 'applied');
    return { ...result, safetyBackup: appliedSafety };
  } catch (error: unknown) {
    const safetyReferences = safety.manifest.files.map((snapshot) => ({
      directory: safety.directory,
      snapshot,
    }));
    await applySnapshotReferences(safetyReferences).catch(() => undefined);
    await markBackup(safety, 'rolled-back', errorMessage(error));
    throw new Error(`恢复失败，已尝试回滚当前配置：${errorMessage(error)}`);
  }
}

export async function restoreOperation(
  backupDirectory: string,
  options: RestoreOptions,
): Promise<RestoreResult> {
  const backup = await readBackup(backupDirectory);
  if (
    backup.manifest.kind !== 'configuration' ||
    backup.manifest.status !== 'applied'
  ) {
    throw new Error('只能选择已成功应用的配置操作备份进行恢复。');
  }
  const references = backup.manifest.files.map((snapshot) => ({
    directory: backup.directory,
    snapshot,
  }));
  return restoreReferences(references, options, backup.manifest.id);
}

export async function restoreOriginal(
  options: RestoreOptions,
): Promise<RestoreResult> {
  const backups = (await scanBackups(options.backupRoot)).filter(
    ({ manifest }) =>
      manifest.kind === 'configuration' && manifest.status === 'applied',
  );
  const earliestByPath = new Map<string, SnapshotReference>();
  for (const backup of backups) {
    for (const snapshot of backup.manifest.files) {
      const key = resolve(snapshot.targetPath);
      if (!earliestByPath.has(key)) {
        earliestByPath.set(key, { directory: backup.directory, snapshot });
      }
    }
  }
  if (earliestByPath.size === 0) {
    throw new Error('没有可用于恢复原始状态的 0.3 版备份。');
  }
  return restoreReferences(
    [...earliestByPath.values()],
    options,
    'original-state',
  );
}

/** Rolls back operations that were interrupted after their snapshot was prepared. */
export async function recoverInterruptedOperations(
  options: RestoreOptions,
): Promise<BackupEntry[]> {
  const interrupted = (await scanBackups(options.backupRoot))
    .filter(
      ({ manifest }) =>
        manifest.kind === 'configuration' && manifest.status === 'prepared',
    )
    .reverse();
  const recovered: BackupEntry[] = [];
  for (const backup of interrupted) {
    await Promise.all(
      backup.manifest.files.map((snapshot) =>
        cleanupAtomicWriteTemps(snapshot.targetPath),
      ),
    );
    const references = backup.manifest.files.map((snapshot) => ({
      directory: backup.directory,
      snapshot,
    }));
    await restoreReferences(references, options, backup.manifest.id);
    recovered.push(
      await markBackup(
        backup,
        'rolled-back',
        '检测到上次操作中断，已在启动时自动恢复。',
      ),
    );
  }
  return recovered;
}
