import { describe, expect, test } from 'vitest';
import { needsStartupMaintenance, parseCliArgs } from '../src/args.js';

describe('CLI argument parsing', () => {
  test('parses configure flags independently of their order', () => {
    expect(parseCliArgs(['configure', '--skip-probe', '--dry-run'])).toEqual({
      action: 'configure',
      dryRun: true,
      skipProbe: true,
    });
  });

  test('rejects unknown commands before startup maintenance', () => {
    expect(() => parseCliArgs(['typo'])).toThrow(/未知命令：typo/);
  });

  test('rejects unsupported flags', () => {
    expect(() => parseCliArgs(['configure', '--force'])).toThrow(
      /未知参数：--force/,
    );
    expect(() => parseCliArgs(['doctor', '--verbose'])).toThrow(/不接受参数/);
  });

  test('supports menu, help, and version aliases', () => {
    expect(parseCliArgs([])).toEqual({ action: 'menu' });
    expect(parseCliArgs(['-h'])).toEqual({ action: 'help' });
    expect(parseCliArgs(['version'])).toEqual({ action: 'version' });
  });

  test('keeps dry-run and doctor read-only', () => {
    expect(
      needsStartupMaintenance(parseCliArgs(['configure', '--dry-run'])),
    ).toBe(false);
    expect(needsStartupMaintenance(parseCliArgs(['doctor']))).toBe(false);
    expect(needsStartupMaintenance(parseCliArgs(['configure']))).toBe(true);
    expect(needsStartupMaintenance(parseCliArgs([]))).toBe(true);
  });
});
