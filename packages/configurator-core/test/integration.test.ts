import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createClaudeAdapter } from '../src/adapters/claude.js';
import { createCodexAdapter } from '../src/adapters/codex.js';
import { createOpenCodeAdapter } from '../src/adapters/opencode.js';
import { restoreOriginal } from '../src/backup.js';
import { pathExists } from '../src/filesystem.js';
import { applyConfiguration } from '../src/transaction.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('built-in adapter integration', () => {
  test('is idempotent across all clients and restores an initially empty home', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'friendaix-integration-'));
    temporaryDirectories.push(homeDir);
    const backupRoot = join(homeDir, '.friendaix', 'backups');
    const context = { homeDir };
    const clients = [
      createClaudeAdapter({
        defaultModel: 'claude-main',
        defaultSmallModel: 'claude-small',
      }),
      createCodexAdapter({
        providerId: 'friendaix',
        providerName: 'FriendAIX',
      }),
      createOpenCodeAdapter({
        providerId: 'friendaix',
        providerName: 'FriendAIX',
        defaultModel: 'open-main',
        defaultSmallModel: 'open-small',
      }),
    ];
    const input = {
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-secret',
      primaryModel: 'service-main',
      smallModel: 'service-small',
      availableModels: [{ id: 'service-main' }, { id: 'service-small' }],
    };

    const firstPlans = await Promise.all(
      clients.map((client) => client.plan(input, context)),
    );
    await applyConfiguration(firstPlans, { backupRoot });
    const secondPlans = await Promise.all(
      clients.map((client) => client.plan(input, context)),
    );
    for (const write of secondPlans.flatMap((plan) => plan.writes)) {
      expect(await readFile(write.path, 'utf8')).toBe(write.content);
    }
    await applyConfiguration(secondPlans, { backupRoot });

    const codexConfig = await readFile(
      join(homeDir, '.codex', 'config.toml'),
      'utf8',
    );
    expect(codexConfig.match(/friendaix:friendaix begin/g)).toHaveLength(1);

    const allowedPaths = clients.flatMap((client) =>
      client.configFiles(context),
    );
    const restored = await restoreOriginal({ backupRoot, allowedPaths });
    expect(restored.removed).toHaveLength(5);
    for (const path of firstPlans.flatMap((plan) =>
      plan.writes.map((write) => write.path),
    )) {
      expect(await pathExists(path)).toBe(false);
    }
  });
});
