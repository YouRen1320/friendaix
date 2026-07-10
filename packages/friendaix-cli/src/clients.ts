import {
  createClaudeAdapter,
  createCodexAdapter,
  createOpenCodeAdapter,
  type AdapterContext,
  type ClientAdapter,
} from 'friendaix-core';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_SMALL_MODEL,
  DEFAULT_OPENCODE_MODEL,
  DEFAULT_OPENCODE_SMALL_MODEL,
  PROVIDER_ID,
  PROVIDER_NAME,
} from './preset.js';

// Client definitions are reusable factories; FriendAIX-specific values live in this preset layer.
export const ALL_CLIENTS: ClientAdapter[] = [
  createClaudeAdapter({
    defaultModel: DEFAULT_CLAUDE_MODEL,
    defaultSmallModel: DEFAULT_CLAUDE_SMALL_MODEL,
  }),
  createCodexAdapter({
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
  }),
  createOpenCodeAdapter({
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
    defaultModel: DEFAULT_OPENCODE_MODEL,
    defaultSmallModel: DEFAULT_OPENCODE_SMALL_MODEL,
  }),
];

export function getClient(id: string): ClientAdapter | undefined {
  return ALL_CLIENTS.find((client) => client.id === id);
}

/** Captures path-related process state once for deterministic adapter planning. */
export function adapterContext(homeDir: string): AdapterContext {
  return {
    homeDir,
    environment: process.env,
    platform: process.platform,
  };
}
