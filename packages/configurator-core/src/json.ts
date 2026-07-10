import { readFile } from 'node:fs/promises';
import { assertRecord, errorMessage } from './errors.js';
import { pathExists } from './filesystem.js';

export async function readJsonObject(
  path: string,
): Promise<Record<string, unknown> | null> {
  if (!(await pathExists(path))) return null;
  const text = await readFile(path, 'utf8');
  try {
    const parsed: unknown = JSON.parse(text);
    assertRecord(parsed, path);
    return parsed;
  } catch (error: unknown) {
    throw new Error(
      `${path} 不是合法 JSON，拒绝覆盖。请先修复或移走该文件：${errorMessage(error)}`,
    );
  }
}

export function jsonWithNewline(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
