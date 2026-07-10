import type { ModelOption } from 'friendaix-core';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_SMALL_MODEL,
  DEFAULT_CODEX_MODEL,
  DEFAULT_OPENCODE_MODEL,
  DEFAULT_OPENCODE_SMALL_MODEL,
} from './preset.js';

export function claudeModels(models: ModelOption[]): ModelOption[] {
  return models.filter((model) => model.id.toLowerCase().startsWith('claude'));
}

function preferredModel(
  models: ModelOption[],
  preferences: string[],
  predicate: (id: string) => boolean = () => true,
): string | undefined {
  for (const preference of preferences) {
    const exact = models.find(
      (model) => model.id === preference && predicate(model.id),
    );
    if (exact) return exact.id;
  }
  return models.find((model) => predicate(model.id))?.id;
}

export interface ResolvedModels {
  claudePrimary: string;
  claudeSmall: string;
  codexModel: string;
  openCodePrimary: string;
  openCodeSmall: string;
}

export function resolveModels(
  models: ModelOption[] | null,
  selectedClaudeModel?: string,
): ResolvedModels {
  if (!models || models.length === 0) {
    return {
      claudePrimary: selectedClaudeModel ?? DEFAULT_CLAUDE_MODEL,
      claudeSmall: DEFAULT_CLAUDE_SMALL_MODEL,
      codexModel: DEFAULT_CODEX_MODEL,
      openCodePrimary: DEFAULT_OPENCODE_MODEL,
      openCodeSmall: DEFAULT_OPENCODE_SMALL_MODEL,
    };
  }

  const claudePrimary =
    selectedClaudeModel ??
    preferredModel(models, [DEFAULT_CLAUDE_MODEL], (id) =>
      id.toLowerCase().startsWith('claude'),
    ) ??
    DEFAULT_CLAUDE_MODEL;
  const claudeSmall =
    preferredModel(models, [DEFAULT_CLAUDE_SMALL_MODEL], (id) => {
      const lower = id.toLowerCase();
      return lower.startsWith('claude') && lower.includes('haiku');
    }) ?? claudePrimary;
  const codexModel =
    preferredModel(models, [DEFAULT_CODEX_MODEL], (id) =>
      /^(gpt|o\d)/i.test(id),
    ) ?? models[0]!.id;
  const openCodePrimary =
    preferredModel(models, [DEFAULT_OPENCODE_MODEL, codexModel]) ??
    models[0]!.id;
  const openCodeSmall =
    preferredModel(
      models,
      [DEFAULT_OPENCODE_SMALL_MODEL, DEFAULT_CLAUDE_SMALL_MODEL],
      (id) => /mini|small|haiku|nano/i.test(id),
    ) ?? openCodePrimary;

  return {
    claudePrimary,
    claudeSmall,
    codexModel,
    openCodePrimary,
    openCodeSmall,
  };
}
