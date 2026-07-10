import { isAbsolute, join } from 'node:path';
import { assertRecord } from '../errors.js';
import { pathExists } from '../filesystem.js';
import { jsonWithNewline, readJsonObjectFile } from '../json.js';
import type {
  AdapterContext,
  AdapterPlan,
  ClientAdapter,
  ConfigureInput,
} from '../types.js';
import { assertConfigureInput } from '../validation.js';

export interface ClaudeAdapterOptions {
  id?: string;
  name?: string;
  defaultModel: string;
  defaultSmallModel: string;
}

function stripV1(url: string): string {
  return url.replace(/\/v1\/?$/, '');
}

export function createClaudeAdapter(
  options: ClaudeAdapterOptions,
): ClientAdapter {
  if (!options.defaultModel.trim() || !options.defaultSmallModel.trim()) {
    throw new Error('Claude 默认模型 ID 不能为空。');
  }
  const id = options.id ?? 'claude';
  const name = options.name ?? 'Claude Code';
  if (!id.trim() || !name.trim()) {
    throw new Error('Claude adapter ID 和名称不能为空。');
  }
  const settingsDirectory = (context: AdapterContext) => {
    const override = context.environment?.CLAUDE_CONFIG_DIR;
    if (override) {
      if (!isAbsolute(override)) {
        throw new Error('CLAUDE_CONFIG_DIR 必须是绝对路径。');
      }
      return override;
    }
    return join(context.homeDir, '.claude');
  };
  const settingsPath = (context: AdapterContext) =>
    join(settingsDirectory(context), 'settings.json');

  return {
    id,
    name,

    configFiles(context) {
      return [settingsPath(context)];
    },

    async isInstalled(context) {
      return pathExists(settingsDirectory(context));
    },

    async plan(
      input: ConfigureInput,
      context: AdapterContext,
    ): Promise<AdapterPlan> {
      assertConfigureInput(input);
      const path = settingsPath(context);
      const settings = await readJsonObjectFile(path);
      const existing = settings.value ?? {};
      const previousEnv = existing.env ?? {};
      assertRecord(previousEnv, `${path} 的 env`);

      const nextEnv: Record<string, unknown> = {
        ...previousEnv,
        ANTHROPIC_BASE_URL: stripV1(input.baseUrl),
        ANTHROPIC_AUTH_TOKEN: input.apiKey,
        ANTHROPIC_MODEL: input.primaryModel ?? options.defaultModel,
        ANTHROPIC_DEFAULT_HAIKU_MODEL:
          input.smallModel ?? options.defaultSmallModel,
      };
      // Claude Code deprecated this key; removing it avoids two competing aliases.
      delete nextEnv.ANTHROPIC_SMALL_FAST_MODEL;
      const merged = {
        ...existing,
        env: nextEnv,
      };
      return {
        clientId: id,
        clientName: name,
        writes: [
          {
            clientId: id,
            path,
            content: jsonWithNewline(merged),
            containsSecret: true,
            expected: settings.expectation,
            mode: 0o600,
          },
        ],
        warnings: [],
      };
    },
  };
}
