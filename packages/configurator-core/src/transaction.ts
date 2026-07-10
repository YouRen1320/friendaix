import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createSnapshotBackup, markBackup } from './backup.js';
import { errorMessage } from './errors.js';
import { atomicWriteFile } from './filesystem.js';
import type {
  AdapterPlan,
  ApplyConfigurationOptions,
  BackupEntry,
  PlannedWrite,
} from './types.js';

function flattenWrites(plans: AdapterPlan[]): PlannedWrite[] {
  const writes = plans.flatMap((plan) => plan.writes);
  const seen = new Set<string>();
  for (const write of writes) {
    const key = resolve(write.path);
    if (seen.has(key)) {
      throw new Error(`多个客户端计划写入同一文件：${write.path}`);
    }
    seen.add(key);
  }
  return writes;
}

async function rollback(entry: BackupEntry): Promise<void> {
  for (const snapshot of entry.manifest.files) {
    if (!snapshot.existed) {
      await rm(snapshot.targetPath, { force: true });
      continue;
    }
    if (!snapshot.backupFile) continue;
    const content = await readFile(join(entry.directory, snapshot.backupFile));
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

  try {
    for (const write of writes) {
      const snapshot = snapshotByPath.get(resolve(write.path));
      const mode = write.containsSecret
        ? 0o600
        : (write.mode ?? snapshot?.originalMode ?? 0o600);
      await atomicWriteFile(write.path, write.content, mode);
    }
    return markBackup(backup, 'applied');
  } catch (error: unknown) {
    const rollbackError = await rollback(backup).then(
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
