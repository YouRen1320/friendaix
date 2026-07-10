import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  atomicWriteFile,
  ensurePrivateDirectory,
  pathExists,
} from 'friendaix-core';
import { readFile } from 'node:fs/promises';
import { BACKUP_DIR_NAME, STATE_DIR_NAME, STATE_FILE_NAME } from './preset.js';

export interface State {
  schemaVersion: 2;
  selectedSite?: string;
  lastUsed?: string;
  clientsConfigured?: string[];
}

export const stateDir = (homeDir = homedir()) => join(homeDir, STATE_DIR_NAME);
export const stateFile = (homeDir = homedir()) =>
  join(stateDir(homeDir), STATE_FILE_NAME);
export const backupDir = (homeDir = homedir()) =>
  join(stateDir(homeDir), BACKUP_DIR_NAME);

export async function readState(homeDir = homedir()): Promise<State> {
  const path = stateFile(homeDir);
  if (!(await pathExists(path))) return { schemaVersion: 2 };
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      schemaVersion: 2,
      ...(typeof raw.selectedSite === 'string'
        ? { selectedSite: raw.selectedSite }
        : {}),
      ...(typeof raw.lastUsed === 'string' ? { lastUsed: raw.lastUsed } : {}),
      ...(Array.isArray(raw.clientsConfigured)
        ? {
            clientsConfigured: raw.clientsConfigured.filter(
              (item): item is string => typeof item === 'string',
            ),
          }
        : {}),
    };
  } catch {
    return { schemaVersion: 2 };
  }
}

export async function writeState(
  patch: Partial<Omit<State, 'schemaVersion'>>,
  homeDir = homedir(),
): Promise<State> {
  await ensurePrivateDirectory(stateDir(homeDir));
  const current = await readState(homeDir);
  const next: State = {
    ...current,
    ...patch,
    schemaVersion: 2,
    lastUsed: new Date().toISOString(),
  };
  await atomicWriteFile(
    stateFile(homeDir),
    `${JSON.stringify(next, null, 2)}\n`,
    0o600,
  );
  return next;
}

/** Removes the plaintext API key written by friendaix <=0.2 without retaining it elsewhere. */
export async function migrateLegacyState(
  homeDir = homedir(),
): Promise<boolean> {
  const path = stateFile(homeDir);
  if (!(await pathExists(path))) return false;
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<
      string,
      unknown
    >;
    if (!Object.hasOwn(raw, 'apiKey')) return false;
    const sanitized = await readState(homeDir);
    await ensurePrivateDirectory(stateDir(homeDir));
    await atomicWriteFile(
      path,
      `${JSON.stringify(sanitized, null, 2)}\n`,
      0o600,
    );
    return true;
  } catch {
    return false;
  }
}
