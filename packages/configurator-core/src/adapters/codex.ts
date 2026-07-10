import { isAbsolute, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { pathExists, readOptionalFileWithExpectation } from '../filesystem.js';
import { jsonWithNewline, readJsonObjectFile } from '../json.js';
import type {
  AdapterContext,
  AdapterPlan,
  ClientAdapter,
  ConfigureInput,
  PlanWarning,
} from '../types.js';
import { assertConfigureInput } from '../validation.js';

export interface CodexAdapterOptions {
  id?: string;
  name?: string;
  providerId: string;
  providerName: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function setTopLevelValue(
  toml: string,
  key: string,
  encodedValue: string,
): string {
  const lines = toml.split('\n');
  let firstSection = lines.findIndex((line) => /^\s*\[/.test(line));
  if (firstSection === -1) firstSection = lines.length;
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  for (let index = 0; index < firstSection; index += 1) {
    if (keyPattern.test(lines[index] ?? '')) {
      lines[index] = `${key} = ${encodedValue}`;
      return lines.join('\n');
    }
  }
  lines.unshift(`${key} = ${encodedValue}`);
  return lines.join('\n');
}

function providerMarkers(providerId: string): { begin: string; end: string } {
  return {
    begin: `# >>> friendaix:${providerId} begin >>>`,
    end: `# <<< friendaix:${providerId} end <<<`,
  };
}

function replaceProviderBlock(
  toml: string,
  options: CodexAdapterOptions,
  baseUrl: string,
): string {
  const markers = providerMarkers(options.providerId);
  const oldCurrent = new RegExp(
    `${escapeRegExp(markers.begin)}[\\s\\S]*?${escapeRegExp(markers.end)}\\n?`,
    'g',
  );
  // Read-only migration for the markers used by friendaix 0.1-0.2.
  const oldLegacy =
    /# >>> friendaix begin >>>[\s\S]*?# <<< friendaix end <<<\n?/g;
  const stripped = toml
    .replace(oldCurrent, '')
    .replace(oldLegacy, '')
    .trimEnd();
  const block = [
    markers.begin,
    `[model_providers.${options.providerId}]`,
    `name = ${tomlString(options.providerName)}`,
    `base_url = ${tomlString(baseUrl)}`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    markers.end,
  ].join('\n');
  return `${stripped ? `${stripped}\n\n` : '\n'}${block}\n`;
}

export function createCodexAdapter(
  options: CodexAdapterOptions,
): ClientAdapter {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(options.providerId)) {
    throw new Error(`非法 Codex provider id：${options.providerId}`);
  }
  if (!options.providerName.trim()) {
    throw new Error('Codex provider 显示名称不能为空。');
  }
  const id = options.id ?? 'codex';
  const name = options.name ?? 'Codex CLI';
  if (!id.trim() || !name.trim()) {
    throw new Error('Codex adapter ID 和名称不能为空。');
  }
  const codexDirectory = (context: AdapterContext) => {
    const override = context.environment?.CODEX_HOME;
    if (override) {
      if (!isAbsolute(override)) {
        throw new Error('CODEX_HOME 必须是绝对路径。');
      }
      return override;
    }
    return join(context.homeDir, '.codex');
  };
  const authPath = (context: AdapterContext) =>
    join(codexDirectory(context), 'auth.json');
  const configPath = (context: AdapterContext) =>
    join(codexDirectory(context), 'config.toml');

  return {
    id,
    name,

    configFiles(context) {
      return [authPath(context), configPath(context)];
    },

    async isInstalled(context) {
      return pathExists(codexDirectory(context));
    },

    async plan(
      input: ConfigureInput,
      context: AdapterContext,
    ): Promise<AdapterPlan> {
      assertConfigureInput(input);
      const authFile = authPath(context);
      const configFile = configPath(context);
      const authDocument = await readJsonObjectFile(authFile);
      const auth = authDocument.value ?? {};
      const warnings: PlanWarning[] = [];
      if (
        auth.auth_mode === 'chatgpt' ||
        Object.hasOwn(auth, 'tokens') ||
        Object.hasOwn(auth, 'last_refresh')
      ) {
        warnings.push({
          code: 'codex-chatgpt-login-replaced',
          destructive: true,
          message:
            'Codex 当前保存了 ChatGPT 登录。继续后会切换成 FriendAIX API Key，并移除现有 OAuth token；本次事务备份可恢复原登录文件。',
        });
      }
      const nextAuth = { ...auth };
      nextAuth.auth_mode = 'apikey';
      nextAuth.OPENAI_API_KEY = input.apiKey;
      delete nextAuth.tokens;
      delete nextAuth.last_refresh;

      const configDocument = await readOptionalFileWithExpectation(configFile);
      let config = configDocument.content?.toString('utf8') ?? '';
      if (config.trim()) parseToml(config);
      config = replaceProviderBlock(config, options, input.baseUrl);
      config = setTopLevelValue(
        config,
        'model_provider',
        tomlString(options.providerId),
      );
      if (input.primaryModel) {
        config = setTopLevelValue(
          config,
          'model',
          tomlString(input.primaryModel),
        );
      }
      parseToml(config);

      return {
        clientId: id,
        clientName: name,
        writes: [
          {
            clientId: id,
            path: authFile,
            content: jsonWithNewline(nextAuth),
            containsSecret: true,
            expected: authDocument.expectation,
            mode: 0o600,
          },
          {
            clientId: id,
            path: configFile,
            content: config,
            containsSecret: false,
            expected: configDocument.expectation,
          },
        ],
        warnings,
      };
    },
  };
}
