import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function readOptionalFile(path: string): Promise<Buffer | null> {
  return (await pathExists(path)) ? readFile(path) : null;
}

export async function fileMode(path: string): Promise<number | undefined> {
  if (!(await pathExists(path))) return undefined;
  return (await lstat(path)).mode & 0o777;
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
    await chmod(targetPath, mode);
  } catch (error: unknown) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
