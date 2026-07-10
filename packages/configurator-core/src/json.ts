import { assertRecord, errorMessage } from './errors.js';
import { readOptionalFileWithExpectation } from './filesystem.js';
import type { FileExpectation } from './types.js';

export interface JsonObjectFile {
  value: Record<string, unknown> | null;
  expectation: FileExpectation;
}

export async function readJsonObjectFile(
  path: string,
): Promise<JsonObjectFile> {
  const { content, expectation } = await readOptionalFileWithExpectation(path);
  if (!content) return { value: null, expectation };
  try {
    const parsed: unknown = JSON.parse(content.toString('utf8'));
    assertRecord(parsed, path);
    return { value: parsed, expectation };
  } catch (error: unknown) {
    throw new Error(
      `${path} 不是合法 JSON，拒绝覆盖。请先修复或移走该文件：${errorMessage(error)}`,
    );
  }
}

export function jsonWithNewline(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
