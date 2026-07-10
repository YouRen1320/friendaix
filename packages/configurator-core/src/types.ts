export interface AdapterContext {
  /** Home directory used to resolve all user-scoped client files. */
  homeDir: string;
}

export interface ModelOption {
  id: string;
  displayName?: string;
}

export interface ConfigureInput {
  baseUrl: string;
  apiKey: string;
  primaryModel?: string;
  smallModel?: string;
  availableModels?: ModelOption[];
}

export interface PlanWarning {
  code: string;
  message: string;
  destructive?: boolean;
}

export interface PlannedWrite {
  clientId: string;
  path: string;
  content: string;
  containsSecret: boolean;
  mode?: number;
}

export interface AdapterPlan {
  clientId: string;
  clientName: string;
  writes: PlannedWrite[];
  warnings: PlanWarning[];
}

export interface ClientAdapter {
  id: string;
  name: string;
  configFiles(context: AdapterContext): string[];
  isInstalled(context: AdapterContext): Promise<boolean>;
  plan(input: ConfigureInput, context: AdapterContext): Promise<AdapterPlan>;
}

export type BackupKind = 'configuration' | 'restore-safety';
export type BackupStatus = 'prepared' | 'applied' | 'rolled-back';

export interface FileSnapshot {
  clientId: string;
  targetPath: string;
  existed: boolean;
  backupFile?: string;
  originalMode?: number;
  sha256?: string;
}

export interface BackupManifest {
  schemaVersion: 2;
  id: string;
  kind: BackupKind;
  createdAt: string;
  status: BackupStatus;
  clients: string[];
  files: FileSnapshot[];
  sourceBackupId?: string;
  error?: string;
}

export interface BackupEntry {
  directory: string;
  manifest: BackupManifest;
}

export interface ApplyConfigurationOptions {
  backupRoot: string;
}

export interface RestoreOptions {
  backupRoot: string;
  allowedPaths: Iterable<string>;
}

export interface RestoreResult {
  restored: string[];
  removed: string[];
  safetyBackup: BackupEntry;
}
