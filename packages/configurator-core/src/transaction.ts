import { rm } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import {
  createSnapshotBackup,
  markBackup,
  readSnapshotContent,
} from './backup.js';
import { errorMessage } from './errors.js';
import {
  atomicWriteFile,
  readOptionalFileWithExpectation,
} from './filesystem.js';
import type {
  AdapterPlan,
  ApplyConfigurationOptions,
  BackupEntry,
  FileExpectation,
  FileSnapshot,
  PlannedWrite,
} from './types.js';

function flattenWrites(plans: AdapterPlan[]): PlannedWrite[] {
  const writes: PlannedWrite[] = [];
  const seen = new Set<string>();
  for (const plan of plans) {
    if (!plan.clientId || !Array.isArray(plan.writes)) {
      throw new Error('配置计划缺少客户端 ID 或写入列表。');
    }
    for (const write of plan.writes) {
      if (
        write.clientId !== plan.clientId ||
        typeof write.path !== 'string' ||
        !isAbsolute(write.path) ||
        typeof write.content !== 'string' ||
        typeof write.containsSecret !== 'boolean' ||
        !write.expected ||
        typeof write.expected.existed !== 'boolean' ||
        (write.expected.existed &&
          (typeof write.expected.sha256 !== 'string' ||
            !/^[a-f0-9]{64}$/.test(write.expected.sha256))) ||
        (!write.expected.existed && write.expected.sha256 !== undefined) ||
        (write.mode !== undefined &&
          (!Number.isInteger(write.mode) ||
            write.mode < 0 ||
            write.mode > 0o777))
      ) {
        throw new Error(`客户端 ${plan.clientId} 包含非法写入计划。`);
      }
      const key = resolve(write.path);
      if (seen.has(key)) {
        throw new Error(`多个客户端计划写入同一文件：${write.path}`);
      }
      seen.add(key);
      writes.push(write);
    }
  }
  return writes;
}

function matchesExpectation(
  expected: FileExpectation,
  actual: Pick<FileSnapshot, 'existed' | 'sha256'>,
): boolean {
  return (
    expected.existed === actual.existed &&
    (!expected.existed || expected.sha256 === actual.sha256)
  );
}

async function rollback(
  entry: BackupEntry,
  writtenPaths: ReadonlySet<string>,
): Promise<void> {
  for (const snapshot of [...entry.manifest.files].reverse()) {
    if (!writtenPaths.has(resolve(snapshot.targetPath))) continue;
    if (!snapshot.existed) {
      await rm(snapshot.targetPath, { force: true });
      continue;
    }
    if (!snapshot.backupFile) continue;
    const content = await readSnapshotContent(entry.directory, snapshot);
    await atomicWriteFile(
      snapshot.targetPath,
      content,
      snapshot.originalMode ?? 0o600,
    );
  }
}

/** Applies all client writes as one operation and rolls back every prior write on failure. */
export async function applyConfiguration(
  plans: AdapterPlan[],
  options: ApplyConfigurationOptions,
): Promise<BackupEntry> {
  const writes = flattenWrites(plans);
  if (writes.length === 0) throw new Error('配置计划为空。');

  const backup = await createSnapshotBackup(
    options.backupRoot,
    'configuration',
    writes.map((write) => ({
      clientId: write.clientId,
      targetPath: write.path,
    })),
  );
  const snapshotByPath = new Map(
    backup.manifest.files.map((snapshot) => [
      resolve(snapshot.targetPath),
      snapshot,
    ]),
  );

  const staleWrites = writes.filter((write) => {
    const snapshot = snapshotByPath.get(resolve(write.path));
    return !snapshot || !matchesExpectation(write.expected, snapshot);
  });
  if (staleWrites.length > 0) {
    const message = `配置文件在计划生成后已变化，拒绝覆盖：${staleWrites
      .map((write) => write.path)
      .join('、')}`;
    await markBackup(backup, 'rolled-back', message);
    throw new Error(message);
  }

  const writtenPaths = new Set<string>();
  try {
    for (const write of writes) {
      const snapshot = snapshotByPath.get(resolve(write.path));
      if (!snapshot) throw new Error(`配置快照缺少文件：${write.path}`);
      const current = await readOptionalFileWithExpectation(write.path);
      if (!matchesExpectation(current.expectation, snapshot)) {
        throw new Error(`配置文件在写入前已变化：${write.path}`);
      }
      const mode = write.containsSecret
        ? 0o600
        : (write.mode ?? snapshot?.originalMode ?? 0o600);
      await atomicWriteFile(write.path, write.content, mode);
      writtenPaths.add(resolve(write.path));
    }
    return markBackup(backup, 'applied');
  } catch (error: unknown) {
    const rollbackError = await rollback(backup, writtenPaths).then(
      () => undefined,
      (failure: unknown) => errorMessage(failure),
    );
    await markBackup(
      backup,
      'rolled-back',
      rollbackError
        ? `${errorMessage(error)}；回滚失败：${rollbackError}`
        : errorMessage(error),
    );
    if (rollbackError) {
      throw new Error(
        `配置失败且回滚未完全成功：${errorMessage(error)}；${rollbackError}`,
      );
    }
    throw new Error(`配置失败，已回滚本次写入：${errorMessage(error)}`);
  }
}
