import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
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
      { homeDir, platform: 'linux' },
    );
    const content = JSON.parse(result.writes[0]!.content) as Record<
      string,
      any
    >;
    expect(content.theme).toBe('dark');
    expect(content.env.KEEP).toBe('yes');
    expect(content.env.ANTHROPIC_BASE_URL).toBe('https://example.test');
    expect(content.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-small');
    expect(content.env.ANTHROPIC_SMALL_FAST_MODEL).toBeUndefined();
    expect(result.writes[0]!.expected.existed).toBe(true);
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
      {
        baseUrl: 'https://example.test/v1',
        apiKey: 'new-secret',
        primaryModel: 'service-model',
      },
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
    expect(parsed.model).toBe('service-model');
    expect(parsed.model_provider).toBe('friendaix');
    expect(parsed.tui.notifications).toBe(true);
    expect(parsed.model_providers.friendaix.requires_openai_auth).toBe(true);
  });

  test('OpenCode preserves custom provider options and uses the supplied model list', async () => {
    const homeDir = await home();
    const directory = join(homeDir, '.config', 'opencode');
    const authDirectory = join(homeDir, '.local', 'share', 'opencode');
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(directory, { recursive: true }),
    );
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(authDirectory, { recursive: true }),
    );
    await writeFile(
      join(authDirectory, 'auth.json'),
      JSON.stringify({ other: { type: 'api', key: 'keep-me' } }),
    );
    await writeFile(
      join(directory, 'opencode.json'),
      JSON.stringify({
        theme: 'system',
        provider: {
          friendaix: {
            options: { timeout: 1234, apiKey: 'legacy-secret' },
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
      { homeDir, platform: 'linux' },
    );
    expect(result.writes).toHaveLength(2);
    const auth = JSON.parse(result.writes[0]!.content) as Record<string, any>;
    expect(auth.other.key).toBe('keep-me');
    expect(auth.friendaix).toEqual({ type: 'api', key: 'secret' });
    expect(result.writes[0]!.path).toBe(join(authDirectory, 'auth.json'));
    expect(result.writes[0]!.containsSecret).toBe(true);
    const config = JSON.parse(result.writes[1]!.content) as Record<string, any>;
    expect(config.theme).toBe('system');
    expect(config.provider.friendaix.options.timeout).toBe(1234);
    expect(config.provider.friendaix.options.apiKey).toBeUndefined();
    expect(config.provider.friendaix.options.baseURL).toBe(
      'https://example.test/v1',
    );
    expect(config.provider.friendaix.models.custom.name).toBe('Custom');
    expect(config.model).toBe('friendaix/main-model');
    expect(config.small_model).toBe('friendaix/small-model');
    expect(result.writes[1]!.containsSecret).toBe(false);
  });

  test('OpenCode updates higher-priority JSONC and removes a legacy key from JSON', async () => {
    const homeDir = await home();
    const directory = join(homeDir, '.config', 'opencode');
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(directory, { recursive: true }),
    );
    await writeFile(
      join(directory, 'opencode.json'),
      JSON.stringify({
        provider: {
          friendaix: {
            options: { apiKey: 'legacy-secret', lowerPriority: true },
          },
        },
      }),
    );
    await writeFile(
      join(directory, 'opencode.jsonc'),
      `{
  // This user comment must survive managed edits.
  "theme": "system",
  "provider": {
    "friendaix": {
      "options": { "timeout": 1234 },
      "models": { "custom": { "name": "Custom" } },
    },
  },
}
`,
    );
    const adapter = createOpenCodeAdapter({
      providerId: 'friendaix',
      providerName: 'FriendAIX',
      defaultModel: 'main',
      defaultSmallModel: 'small',
    });
    const result = await adapter.plan(
      { baseUrl: 'https://example.test/v1', apiKey: 'secret' },
      { homeDir, platform: 'linux' },
    );

    expect(result.writes).toHaveLength(3);
    const jsoncWrite = result.writes.find((write) =>
      write.path.endsWith('opencode.jsonc'),
    )!;
    const jsonWrite = result.writes.find((write) =>
      write.path.endsWith('opencode.json'),
    )!;
    expect(jsoncWrite.content).toContain('This user comment must survive');
    const jsonc = parseJsonc(jsoncWrite.content) as Record<string, any>;
    expect(jsonc.theme).toBe('system');
    expect(jsonc.provider.friendaix.options.timeout).toBe(1234);
    expect(jsonc.provider.friendaix.options.apiKey).toBeUndefined();
    expect(jsonc.provider.friendaix.models.custom.name).toBe('Custom');
    expect(jsonc.model).toBe('friendaix/main');
    const json = JSON.parse(jsonWrite.content) as Record<string, any>;
    expect(json.provider.friendaix.options.apiKey).toBeUndefined();
    expect(json.provider.friendaix.options.lowerPriority).toBe(true);
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

  test.skipIf(process.platform === 'win32')(
    'refuses symlinked config files instead of replacing the link',
    async () => {
      const homeDir = await home();
      const directory = join(homeDir, '.claude');
      await import('node:fs/promises').then(({ mkdir }) =>
        mkdir(directory, { recursive: true }),
      );
      const managedElsewhere = join(homeDir, 'managed-settings.json');
      await writeFile(managedElsewhere, '{}');
      await symlink(managedElsewhere, join(directory, 'settings.json'));
      const adapter = createClaudeAdapter({
        defaultModel: 'main',
        defaultSmallModel: 'small',
      });

      await expect(
        adapter.plan(
          { baseUrl: 'https://example.test/v1', apiKey: 'secret' },
          { homeDir },
        ),
      ).rejects.toThrow(/只支持普通配置文件/);
      expect(await readFile(managedElsewhere, 'utf8')).toBe('{}');
    },
  );

  test('rejects unsafe URLs and empty credentials before creating a plan', async () => {
    const homeDir = await home();
    const adapter = createClaudeAdapter({
      defaultModel: 'main',
      defaultSmallModel: 'small',
    });
    await expect(
      adapter.plan(
        {
          baseUrl: 'https://user:password@example.test/v1?leak=yes',
          apiKey: 'secret',
        },
        { homeDir },
      ),
    ).rejects.toThrow(/HTTP\(S\) URL/);
    await expect(
      adapter.plan(
        { baseUrl: 'https://example.test/v1', apiKey: '   ' },
        { homeDir },
      ),
    ).rejects.toThrow(/API Key 不能为空/);
    expect(() =>
      createOpenCodeAdapter({
        providerId: 'invalid/id',
        providerName: 'Invalid',
        defaultModel: 'main',
        defaultSmallModel: 'small',
      }),
    ).toThrow(/非法 OpenCode provider id/);
  });

  test('honors explicit client, XDG, and Windows data directories', async () => {
    const homeDir = await home();
    const claudeDirectory = join(homeDir, 'profiles', 'claude');
    const codexDirectory = join(homeDir, 'profiles', 'codex');
    const xdgConfig = join(homeDir, 'xdg-config');
    const xdgData = join(homeDir, 'xdg-data');
    const claude = createClaudeAdapter({
      defaultModel: 'main',
      defaultSmallModel: 'small',
    });
    const codex = createCodexAdapter({
      providerId: 'friendaix',
      providerName: 'FriendAIX',
    });
    const opencode = createOpenCodeAdapter({
      providerId: 'friendaix',
      providerName: 'FriendAIX',
      defaultModel: 'main',
      defaultSmallModel: 'small',
    });

    expect(
      claude.configFiles({
        homeDir,
        environment: { CLAUDE_CONFIG_DIR: claudeDirectory },
      }),
    ).toEqual([join(claudeDirectory, 'settings.json')]);
    expect(
      codex.configFiles({
        homeDir,
        environment: { CODEX_HOME: codexDirectory },
      }),
    ).toEqual([
      join(codexDirectory, 'auth.json'),
      join(codexDirectory, 'config.toml'),
    ]);
    expect(
      opencode.configFiles({
        homeDir,
        platform: 'linux',
        environment: {
          XDG_CONFIG_HOME: xdgConfig,
          XDG_DATA_HOME: xdgData,
        },
      }),
    ).toEqual([
      join(xdgData, 'opencode', 'auth.json'),
      join(xdgConfig, 'opencode', 'opencode.json'),
      join(xdgConfig, 'opencode', 'opencode.jsonc'),
    ]);
    expect(
      opencode.configFiles({
        homeDir,
        platform: 'win32',
        environment: { LOCALAPPDATA: join(homeDir, 'LocalAppData') },
      })[0],
    ).toBe(join(homeDir, 'LocalAppData', 'opencode', 'auth.json'));
    expect(() =>
      codex.configFiles({
        homeDir,
        environment: { CODEX_HOME: 'relative/path' },
      }),
    ).toThrow(/必须是绝对路径/);
  });
});
