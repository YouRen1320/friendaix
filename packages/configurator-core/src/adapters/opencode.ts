import { isAbsolute, join } from 'node:path';
import { assertRecord } from '../errors.js';
import {
  pathExists,
  readOptionalTextFileWithExpectation,
} from '../filesystem.js';
import { jsonWithNewline, readJsonObjectFile } from '../json.js';
import { parseJsoncObject, updateJsonc } from '../jsonc.js';
import type {
  AdapterContext,
  AdapterPlan,
  ClientAdapter,
  ConfigureInput,
  FileExpectation,
  PlannedWrite,
} from '../types.js';
import { assertConfigureInput } from '../validation.js';

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
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(options.providerId)) {
    throw new Error(`非法 OpenCode provider id：${options.providerId}`);
  }
  if (
    !options.providerName.trim() ||
    !options.defaultModel.trim() ||
    !options.defaultSmallModel.trim()
  ) {
    throw new Error('OpenCode provider 名称和默认模型不能为空。');
  }
  const id = options.id ?? 'opencode';
  const name = options.name ?? 'OpenCode';
  if (!id.trim() || !name.trim()) {
    throw new Error('OpenCode adapter ID 和名称不能为空。');
  }
  const environmentDirectory = (
    context: AdapterContext,
    variableName: string,
  ): string | undefined => {
    const value = context.environment?.[variableName];
    if (!value) return undefined;
    if (!isAbsolute(value)) {
      throw new Error(`${variableName} 必须是绝对路径。`);
    }
    return value;
  };
  const dataDirectory = (context: AdapterContext) => {
    const xdg = environmentDirectory(context, 'XDG_DATA_HOME');
    if (xdg) return join(xdg, 'opencode');
    if ((context.platform ?? process.platform) === 'win32') {
      const localAppData =
        environmentDirectory(context, 'LOCALAPPDATA') ??
        join(context.homeDir, 'AppData', 'Local');
      return join(localAppData, 'opencode');
    }
    return join(context.homeDir, '.local', 'share', 'opencode');
  };
  const configDirectory = (context: AdapterContext) => {
    const explicit = environmentDirectory(context, 'OPENCODE_CONFIG_DIR');
    if (explicit) return explicit;
    const xdg = environmentDirectory(context, 'XDG_CONFIG_HOME');
    return xdg
      ? join(xdg, 'opencode')
      : join(context.homeDir, '.config', 'opencode');
  };
  const authPath = (context: AdapterContext) =>
    join(dataDirectory(context), 'auth.json');
  const jsonPath = (context: AdapterContext) =>
    join(configDirectory(context), 'opencode.json');
  const jsoncPath = (context: AdapterContext) =>
    join(configDirectory(context), 'opencode.jsonc');

  return {
    id,
    name,

    configFiles(context) {
      return [authPath(context), jsonPath(context), jsoncPath(context)];
    },

    async isInstalled(context) {
      const locations = await Promise.all([
        pathExists(configDirectory(context)),
        pathExists(dataDirectory(context)),
      ]);
      return locations.some(Boolean);
    },

    async plan(
      input: ConfigureInput,
      context: AdapterContext,
    ): Promise<AdapterPlan> {
      assertConfigureInput(input);
      const authFile = authPath(context);
      const configJsonFile = jsonPath(context);
      const configJsoncFile = jsoncPath(context);
      const authDocument = await readJsonObjectFile(authFile);
      const jsonDocument = await readJsonObjectFile(configJsonFile);
      const jsoncDocument =
        await readOptionalTextFileWithExpectation(configJsoncFile);
      const usesJsonc = jsoncDocument.content !== null;
      const configFile = usesJsonc ? configJsoncFile : configJsonFile;
      const existing = usesJsonc
        ? parseJsoncObject(configJsoncFile, jsoncDocument.content!)
        : (jsonDocument.value ?? {});
      const existingAuth = authDocument.value ?? {};
      const providerRoot = existing.provider ?? {};
      assertRecord(providerRoot, `${configFile} 的 provider`);
      const previousProvider = providerRoot[options.providerId] ?? {};
      assertRecord(
        previousProvider,
        `${configFile} 的 provider.${options.providerId}`,
      );
      const previousOptions = previousProvider.options ?? {};
      const previousModels = previousProvider.models ?? {};
      assertRecord(
        previousOptions,
        `${configFile} 的 provider.${options.providerId}.options`,
      );
      assertRecord(
        previousModels,
        `${configFile} 的 provider.${options.providerId}.models`,
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

      const providerOptions: Record<string, unknown> = {
        ...previousOptions,
        baseURL: input.baseUrl,
      };
      // Migrate FriendAIX <=0.3 prerelease config to OpenCode's credential store.
      delete providerOptions.apiKey;
      const mergedProvider = {
        ...previousProvider,
        npm: '@ai-sdk/openai-compatible',
        name: options.providerName,
        options: providerOptions,
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
            path: authFile,
            content: jsonWithNewline({
              ...existingAuth,
              [options.providerId]: { type: 'api', key: input.apiKey },
            }),
            containsSecret: true,
            expected: authDocument.expectation,
            mode: 0o600,
          },
          {
            clientId: id,
            path: configFile,
            content: usesJsonc
              ? updateJsonc(jsoncDocument.content!, [
                  {
                    path: ['$schema'],
                    value:
                      existing.$schema ?? 'https://opencode.ai/config.json',
                  },
                  {
                    path: ['provider', options.providerId],
                    value: mergedProvider,
                  },
                  {
                    path: ['model'],
                    value: `${options.providerId}/${primaryModel}`,
                  },
                  {
                    path: ['small_model'],
                    value: `${options.providerId}/${smallModel}`,
                  },
                ])
              : jsonWithNewline(merged),
            containsSecret: false,
            expected: usesJsonc
              ? jsoncDocument.expectation
              : jsonDocument.expectation,
          },
          ...(usesJsonc && jsonDocument.value
            ? sanitizeLegacyJson(
                id,
                options.providerId,
                configJsonFile,
                jsonDocument.value,
                jsonDocument.expectation,
              )
            : []),
        ],
        warnings: [],
      };
    },
  };
}

function sanitizeLegacyJson(
  clientId: string,
  providerId: string,
  path: string,
  existing: Record<string, unknown>,
  expected: FileExpectation,
): PlannedWrite[] {
  const providerRoot = existing.provider;
  if (providerRoot === undefined) return [];
  assertRecord(providerRoot, `${path} 的 provider`);
  const provider = providerRoot[providerId];
  if (provider === undefined) return [];
  assertRecord(provider, `${path} 的 provider.${providerId}`);
  const providerOptions = provider.options;
  if (providerOptions === undefined) return [];
  assertRecord(providerOptions, `${path} 的 provider.${providerId}.options`);
  if (!Object.hasOwn(providerOptions, 'apiKey')) return [];
  delete providerOptions.apiKey;
  return [
    {
      clientId,
      path,
      content: jsonWithNewline(existing),
      containsSecret: true,
      expected,
      mode: 0o600,
    },
  ];
}
