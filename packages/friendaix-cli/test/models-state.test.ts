import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { resolveModels } from '../src/models.js';
import { chooseSite } from '../src/sites.js';
import {
  migrateLegacyState,
  readState,
  stateDir,
  stateFile,
  writeState,
} from '../src/state.js';

const temporaryDirectories: string[] = [];

async function home(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'friendaix-cli-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('FriendAIX preset behavior', () => {
  test('uses real service models instead of hardcoded unavailable defaults', () => {
    const resolved = resolveModels([
      { id: 'claude-live' },
      { id: 'gpt-live' },
      { id: 'gpt-live-mini' },
    ]);
    expect(resolved.claudePrimary).toBe('claude-live');
    expect(resolved.codexProbe).toBe('gpt-live');
    expect(resolved.openCodeSmall).toBe('gpt-live-mini');
  });

  test('honors a healthy preferred site', () => {
    const first = {
      site: {
        id: 'first',
        name: 'First',
        baseUrl: 'https://first.test/v1',
        healthCheck: 'https://first.test/health',
      },
      latencyMs: 10,
      ok: true,
    };
    const preferred = {
      site: {
        id: 'preferred',
        name: 'Preferred',
        baseUrl: 'https://preferred.test/v1',
        healthCheck: 'https://preferred.test/health',
      },
      latencyMs: 50,
      ok: true,
    };
    expect(chooseSite([first, preferred], 'preferred')?.site.id).toBe(
      'preferred',
    );
  });

  test('drops legacy API keys from state instead of persisting another copy', async () => {
    const homeDir = await home();
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(stateDir(homeDir), { recursive: true }),
    );
    await writeFile(
      stateFile(homeDir),
      JSON.stringify({ apiKey: 'legacy-secret', selectedSite: 'main' }),
      { mode: 0o644 },
    );
    expect(await readState(homeDir)).toEqual({
      schemaVersion: 2,
      selectedSite: 'main',
    });
    expect(await migrateLegacyState(homeDir)).toBe(true);
    await writeState({ clientsConfigured: ['claude'] }, homeDir);
    const persisted = await readFile(stateFile(homeDir), 'utf8');
    expect(persisted).not.toContain('legacy-secret');
    expect(persisted).not.toContain('apiKey');
    expect((await stat(stateFile(homeDir))).mode & 0o777).toBe(0o600);
  });
});
