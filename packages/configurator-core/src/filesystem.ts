import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { FileExpectation } from './types.js';

interface OptionalFileRead {
  content: Buffer | null;
  expectation: FileExpectation;
}

export interface OptionalTextFileRead {
  content: string | null;
  expectation: FileExpectation;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function readRegularFile(path: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile()) {
    throw new Error(`只支持普通配置文件，拒绝读取：${path}`);
  }
  return readFile(path);
}

/** Reads bytes and their conflict-detection fingerprint in one operation. */
export async function readOptionalFileWithExpectation(
  path: string,
): Promise<OptionalFileRead> {
  try {
    const content = await readRegularFile(path);
    return {
      content,
      expectation: { existed: true, sha256: sha256(content) },
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: null, expectation: { existed: false } };
    }
    throw error;
  }
}

/** Public text-file helper for custom adapters; binary Buffer types stay internal. */
export async function readOptionalTextFileWithExpectation(
  path: string,
): Promise<OptionalTextFileRead> {
  const result = await readOptionalFileWithExpectation(path);
  return {
    content: result.content?.toString('utf8') ?? null,
    expectation: result.expectation,
  };
}

export async function fileMode(path: string): Promise<number | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) {
      throw new Error(`只支持普通配置文件，拒绝读取权限：${path}`);
    }
    return metadata.mode & 0o777;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

/**
 * Writes through a same-directory temporary file so readers never observe a
 * partially written configuration. Secret-bearing callers should pass 0600.
 */
export async function atomicWriteFile(
  targetPath: string,
  content: string | Uint8Array,
  mode = 0o600,
): Promise<void> {
  const parent = dirname(targetPath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const tempPath = join(
    parent,
    `.${basename(targetPath)}.friendaix-${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tempPath, 'wx', mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(tempPath, mode);
    await rename(tempPath, targetPath);
  } catch (error: unknown) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Removes exact FriendAIX temp names left by an interrupted atomic write. */
export async function cleanupAtomicWriteTemps(
  targetPath: string,
): Promise<string[]> {
  const parent = dirname(targetPath);
  const prefix = `.${basename(targetPath)}.friendaix-`;
  let entries: Dirent[];
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    const identifier = entry.name.slice(prefix.length, -'.tmp'.length);
    if (!entry.name.endsWith('.tmp') || !/^[a-f0-9-]{36}$/.test(identifier)) {
      continue;
    }
    const path = join(parent, entry.name);
    await rm(path, { force: true });
    removed.push(path);
  }
  return removed;
}
