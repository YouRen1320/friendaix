import pc from 'picocolors';
import { BRAND, SUBTITLE, VERSION } from './preset.js';

function visualWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xa000 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

export function renderBanner(): string {
  const lines = [`${BRAND} 助手 v${VERSION}`, SUBTITLE];
  const width = Math.max(...lines.map(visualWidth)) + 8;
  const center = (value: string) => {
    const padding = width - visualWidth(value);
    const left = Math.floor(padding / 2);
    return `${' '.repeat(left)}${value}${' '.repeat(padding - left)}`;
  };
  return pc.cyan(
    [
      `╭${'─'.repeat(width)}╮`,
      ...lines.map((line) => `│${center(line)}│`),
      `╰${'─'.repeat(width)}╯`,
    ].join('\n'),
  );
}
