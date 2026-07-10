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

export interface OpenCodeAdapterOptions {
  id?: string;
  name?: string;
  providerId: string;
  providerName: string;
  defaultModel: string;
  defaultSmallModel: string;
}

export function createOpenCodeAdapter(
  options: OpenCodeAdapterOptions,
): ClientAdapter {
  const id = options.id ?? 'opencode';
  const name = options.name ?? 'OpenCode';
  const configPath = (context: AdapterContext) =>
    join(context.homeDir, '.config', 'opencode', 'opencode.json');

  return {
    id,
    name,

    configFiles(context) {
      return [configPath(context)];
    },

    async isInstalled(context) {
      return pathExists(join(context.homeDir, '.config', 'opencode'));
    },

    async plan(
      input: ConfigureInput,
      context: AdapterContext,
    ): Promise<AdapterPlan> {
      const path = configPath(context);
      const existing = (await readJsonObject(path)) ?? {};
      const providerRoot = existing.provider ?? {};
      assertRecord(providerRoot, `${path} 的 provider`);
      const previousProvider = providerRoot[options.providerId] ?? {};
      assertRecord(
        previousProvider,
        `${path} 的 provider.${options.providerId}`,
      );
      const previousOptions = previousProvider.options ?? {};
      const previousModels = previousProvider.models ?? {};
      assertRecord(
        previousOptions,
        `${path} 的 provider.${options.providerId}.options`,
      );
      assertRecord(
        previousModels,
        `${path} 的 provider.${options.providerId}.models`,
      );

      const primaryModel = input.primaryModel ?? options.defaultModel;
      const smallModel = input.smallModel ?? options.defaultSmallModel;
      const models: Record<string, unknown> = { ...previousModels };
      for (const model of input.availableModels ?? []) {
        models[model.id] ??= model.displayName
          ? { name: model.displayName }
          : {};
      }
      models[primaryModel] ??= {};
      models[smallModel] ??= {};

      const mergedProvider = {
        ...previousProvider,
        npm: '@ai-sdk/openai-compatible',
        name: options.providerName,
        options: {
          ...previousOptions,
          baseURL: input.baseUrl,
          apiKey: input.apiKey,
        },
        models,
      };
      const merged = {
        ...existing,
        $schema: existing.$schema ?? 'https://opencode.ai/config.json',
        provider: {
          ...providerRoot,
          [options.providerId]: mergedProvider,
        },
        model: `${options.providerId}/${primaryModel}`,
        small_model: `${options.providerId}/${smallModel}`,
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
