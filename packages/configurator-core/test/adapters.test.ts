import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, describe, expect, test } from 'vitest';
import { createClaudeAdapter } from '../src/adapters/claude.js';
import { createCodexAdapter } from '../src/adapters/codex.js';
import { createOpenCodeAdapter } from '../src/adapters/opencode.js';

const temporaryDirectories: string[] = [];

async function home(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'friendaix-adapter-'));
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

describe('client adapters', () => {
  test('Claude preserves unrelated settings and replaces only managed env keys', async () => {
    const homeDir = await home();
    const path = join(homeDir, '.claude', 'settings.json');
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(join(homeDir, '.claude'), { recursive: true }),
    );
    await writeFile(
      path,
      JSON.stringify({ theme: 'dark', env: { KEEP: 'yes' } }),
    );
    const adapter = createClaudeAdapter({
      defaultModel: 'claude-main',
      defaultSmallModel: 'claude-small',
    });
    const result = await adapter.plan(
      { baseUrl: 'https://example.test/v1', apiKey: 'secret' },
      { homeDir },
    );
    const content = JSON.parse(result.writes[0]!.content) as Record<
      string,
      any
    >;
    expect(content.theme).toBe('dark');
    expect(content.env.KEEP).toBe('yes');
    expect(content.env.ANTHROPIC_BASE_URL).toBe('https://example.test');
    expect(result.writes[0]!.mode).toBe(0o600);
  });

  test('Codex preserves unrelated TOML and warns before replacing ChatGPT login', async () => {
    const homeDir = await home();
    const directory = join(homeDir, '.codex');
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(directory, { recursive: true }),
    );
    await writeFile(
      join(directory, 'auth.json'),
      JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'old' } }),
    );
    await writeFile(
      join(directory, 'config.toml'),
      'model = "gpt-test"\n\n[tui]\nnotifications = true\n',
    );
    const adapter = createCodexAdapter({
      providerId: 'friendaix',
      providerName: 'FriendAIX',
    });
    const result = await adapter.plan(
      { baseUrl: 'https://example.test/v1', apiKey: 'new-secret' },
      { homeDir },
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'codex-chatgpt-login-replaced',
          destructive: true,
        }),
      ]),
    );
    const auth = JSON.parse(result.writes[0]!.content) as Record<
      string,
      unknown
    >;
    expect(auth.auth_mode).toBe('apikey');
    expect(auth.tokens).toBeUndefined();
    const config = result.writes[1]!.content;
    const parsed = parseToml(config) as Record<string, any>;
    expect(parsed.model).toBe('gpt-test');
    expect(parsed.model_provider).toBe('friendaix');
    expect(parsed.tui.notifications).toBe(true);
    expect(parsed.model_providers.friendaix.requires_openai_auth).toBe(true);
  });

  test('OpenCode preserves custom provider options and uses the supplied model list', async () => {
    const homeDir = await home();
    const directory = join(homeDir, '.config', 'opencode');
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(directory, { recursive: true }),
    );
    await writeFile(
      join(directory, 'opencode.json'),
      JSON.stringify({
        theme: 'system',
        provider: {
          friendaix: {
            options: { timeout: 1234 },
            models: { custom: { name: 'Custom' } },
          },
        },
      }),
    );
    const adapter = createOpenCodeAdapter({
      providerId: 'friendaix',
      providerName: 'FriendAIX',
      defaultModel: 'fallback',
      defaultSmallModel: 'fallback-small',
    });
    const result = await adapter.plan(
      {
        baseUrl: 'https://example.test/v1',
        apiKey: 'secret',
        primaryModel: 'main-model',
        smallModel: 'small-model',
        availableModels: [{ id: 'main-model' }, { id: 'small-model' }],
      },
      { homeDir },
    );
    const config = JSON.parse(result.writes[0]!.content) as Record<string, any>;
    expect(config.theme).toBe('system');
    expect(config.provider.friendaix.options.timeout).toBe(1234);
    expect(config.provider.friendaix.models.custom.name).toBe('Custom');
    expect(config.model).toBe('friendaix/main-model');
    expect(config.small_model).toBe('friendaix/small-model');
  });

  test('does not read the real user home directory', async () => {
    const homeDir = await home();
    const adapter = createClaudeAdapter({
      defaultModel: 'main',
      defaultSmallModel: 'small',
    });
    expect(adapter.configFiles({ homeDir })[0]).toBe(
      join(homeDir, '.claude', 'settings.json'),
    );
    await expect(
      readFile(join(homeDir, '.claude', 'settings.json')),
    ).rejects.toThrow();
  });
});
