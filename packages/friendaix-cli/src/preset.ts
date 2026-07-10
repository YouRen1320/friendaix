declare const __FRIENDAIX_VERSION__: string;

export const VERSION =
  typeof __FRIENDAIX_VERSION__ === 'string'
    ? __FRIENDAIX_VERSION__
    : (process.env.npm_package_version ?? 'dev');
export const BRAND = '友人 AI';
export const SUBTITLE = 'Claude Code / Codex / OpenCode 安全配置工具';

export const STATE_DIR_NAME = '.friendaix';
export const STATE_FILE_NAME = 'state.json';
export const BACKUP_DIR_NAME = 'backups';

export const TOKEN_PORTAL_URL = 'https://api.friendaix.com/console/keys';
export const PROVIDER_ID = 'friendaix';
export const PROVIDER_NAME = 'FriendAIX';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_CLAUDE_SMALL_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_OPENCODE_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_OPENCODE_SMALL_MODEL = 'gpt-4o-mini';
export const DEFAULT_CODEX_PROBE_MODEL = 'gpt-5.5';

export interface Site {
  id: string;
  name: string;
  baseUrl: string;
  healthCheck: string;
}

export const SITES: Site[] = [
  {
    id: 'main',
    name: '主线路 (LA)',
    baseUrl: 'https://api.friendaix.com/v1',
    healthCheck: 'https://api.friendaix.com/health',
  },
];
