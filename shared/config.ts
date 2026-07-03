import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ProviderConfig { priority?: number; url?: string; }
export interface ContextConfig { [provider: string]: ProviderConfig; }
export interface WebSearchConfig {
  'default-context'?: string;
  contexts?: ContextConfig;
}
export interface WebFetchConfig {
  jinaEnabled?: boolean;
  'min-delay'?: number;
  'max-delay'?: number;
  'cache-max-files'?: number;
  'heading-threshold'?: number;
}
export interface Settings {
  'web-search': WebSearchConfig;
  'web-fetch': WebFetchConfig;
}

const HOME = os.homedir();
const SETTINGS_PATH = path.join(HOME, '.pi', 'settings.json');

const DEFAULTS: Settings = {
  'web-fetch': {
    jinaEnabled: true,
    'min-delay': 1000,
    'max-delay': 3000,
    'cache-max-files': 100,
    'heading-threshold': 40000,
  },
  'web-search': {
    'default-context': 'general',
    contexts: {
      coding: {
        duckduckgo: { priority: 1 },
        stackoverflow: { priority: 1 },
        npm: { priority: 1 },
        github: { priority: 1 },
      },
      general: {
        duckduckgo: { priority: 1 },
        wikipedia: { priority: 1 },
        jina: { priority: 2 },
      },
    },
  },
};

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = deepClone(target);
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sVal = source[key];
    const rVal = result[key];
    if (
      sVal &&
      typeof sVal === 'object' &&
      !Array.isArray(sVal) &&
      rVal &&
      typeof rVal === 'object' &&
      !Array.isArray(rVal)
    ) {
      (result as any)[key] = deepMerge(rVal as object, sVal as object);
    } else {
      (result as any)[key] = sVal;
    }
  }
  return result;
}

let _cachedSettings: Settings | null = null;

export function loadConfig(): Settings {
  if (_cachedSettings) return _cachedSettings;

  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      _cachedSettings = deepClone(DEFAULTS);
      return _cachedSettings;
    }

    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const userSettings = JSON.parse(raw) as Partial<Settings>;
    _cachedSettings = deepMerge(DEFAULTS, userSettings);
    return _cachedSettings;
  } catch {
    _cachedSettings = deepClone(DEFAULTS);
    return _cachedSettings;
  }
}