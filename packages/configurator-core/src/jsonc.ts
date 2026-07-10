import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError,
} from 'jsonc-parser';
import { assertRecord } from './errors.js';

export function parseJsoncObject(
  path: string,
  content: string,
): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value: unknown = parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new Error(
      `${path} 不是合法 JSONC，拒绝覆盖：${printParseErrorCode(first.error)} at ${first.offset}`,
    );
  }
  assertRecord(value, path);
  return value;
}

interface ResolvedFormattingOptions extends FormattingOptions {
  eol: string;
}

function formattingOptions(content: string): ResolvedFormattingOptions {
  const indentation = content.match(/\r?\n([ \t]+)"/)?.[1] ?? '  ';
  return {
    insertSpaces: !indentation.includes('\t'),
    tabSize: indentation.includes('\t') ? 1 : indentation.length,
    eol: content.includes('\r\n') ? '\r\n' : '\n',
  };
}

/** Applies managed-path edits without rewriting unrelated JSONC comments. */
export function updateJsonc(
  content: string,
  updates: Array<{ path: Array<string | number>; value: unknown }>,
): string {
  const format = formattingOptions(content);
  let next = content;
  for (const update of updates) {
    next = applyEdits(
      next,
      modify(next, update.path, update.value, {
        formattingOptions: format,
      }),
    );
  }
  return next.endsWith(format.eol) ? next : `${next}${format.eol}`;
}
