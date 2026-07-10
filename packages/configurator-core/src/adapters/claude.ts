import { join } from 'node:path';
import { assertRecord } from '../errors.js';
import { pathExists } from '../filesystem.js';
import { jsonWithNewline, readJsonObject } from '../json.js';
import type {
  AdapterContext,
  AdapterPlan,
  ClientAdapter,
  ConfigureInput,
} from '../types.js';

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
  const id = options.id ?? 'claude';
  const name = options.name ?? 'Claude Code';
  const settingsPath = (context: AdapterContext) =>
    join(context.homeDir, '.claude', 'settings.json');

  return {
    id,
    name,

    configFiles(context) {
      return [settingsPath(context)];
    },

    async isInstalled(context) {
      return pathExists(join(context.homeDir, '.claude'));
    },

    async plan(
      input: ConfigureInput,
      context: AdapterContext,
    ): Promise<AdapterPlan> {
      const path = settingsPath(context);
      const existing = (await readJsonObject(path)) ?? {};
      const previousEnv = existing.env ?? {};
      assertRecord(previousEnv, `${path} 的 env`);

      const merged = {
        ...existing,
        env: {
          ...previousEnv,
          ANTHROPIC_BASE_URL: stripV1(input.baseUrl),
          ANTHROPIC_AUTH_TOKEN: input.apiKey,
          ANTHROPIC_MODEL: input.primaryModel ?? options.defaultModel,
          ANTHROPIC_SMALL_FAST_MODEL:
            input.smallModel ?? options.defaultSmallModel,
        },
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
            mode: 0o600,
          },
        ],
        warnings: [],
      };
    },
  };
}
