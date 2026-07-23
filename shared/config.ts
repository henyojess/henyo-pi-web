import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ProviderConfig { priority?: number; url?: string; }
export interface ContextConfig { [provider: string]: ProviderConfig; ranking?: boolean; }
export interface WebSearchConfig {
  'default-context'?: string;
  contexts?: ContextConfig;
  'rate-limit-cooldowns'?: Record<string, number>;
  'max-per-domain'?: number;
  'api-key'?: string;
  /** Trace logging: true for all providers, string[] for specific providers, undefined to disable */
  'trace'?: boolean | string[];
}
export interface WebFetchConfig {
  jinaEnabled?: boolean;
  'min-delay'?: number;
  'max-delay'?: number;
  'cache-max-files'?: number;
  'heading-threshold'?: number;
  'content-threshold'?: number;
  'jina-timeout'?: number;
  'max-response-size'?: number;
}
export interface Settings {
  'henyo-search': WebSearchConfig;
  'henyo-fetch': WebFetchConfig;
}

const HOME = os.homedir();
const SETTINGS_PATH = path.join(HOME, '.pi', 'settings.json');

const DEFAULTS: Settings = {
  'henyo-fetch': {
    jinaEnabled: true,
    'min-delay': 1000,
    'max-delay': 3000,
    'cache-max-files': 100,
    'heading-threshold': 40000,
    'content-threshold': 32000,
    'jina-timeout': 30000,
    'max-response-size': 10485760,
  },
  'henyo-search': {
    'default-context': 'general',
    contexts: {
      coding: {
        duckduckgo: { priority: 1 },
        stackoverflow: { priority: 1 },
        npm: { priority: 1 },
        github: { priority: 1 },
        ranking: true,
      },
      general: {
        duckduckgo: { priority: 1 },
        wikipedia: { priority: 1 },
        ranking: true,
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

// ─── Config Validation ───────────────────────────────────────────────────────

/**
 * Validate henyo-search config. Throws on missing required fields.
 * - searxng provider requires a `url` in its config
 */
export function validateWebSearchConfig(config: WebSearchConfig): void {
  const contexts = config.contexts || {};
  // SearXNG works with bundled public instances — no URL required
  // Users can override with a custom URL via searxng.url in config
}

/**
 * Validate henyo-fetch config. Currently no required fields, but this
 * provides a hook for future validation.
 */
export function validateWebFetchConfig(_config: WebFetchConfig): void {
  // No required fields for henyo-fetch — extend as needed
}

/**
 * Validate all loaded config. Throws on first error.
 */
export function validateConfig(config: Settings): void {
  validateWebSearchConfig(config['henyo-search']);
  validateWebFetchConfig(config['henyo-fetch']);
}

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