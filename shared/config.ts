import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Per-provider settings (only `api-key` today — stackoverflow only) */
export type SearchProviderSettings = {
  'api-key'?: string;
};

export type WebSearchConfig = {
  /** Trace logging: true for all providers, string[] for specific providers, undefined to disable */
  'trace'?: boolean | string[];
  /** Per-provider settings keyed by provider name (stackoverflow, duckduckgo, wikipedia, npm, github) */
  providers?: Record<string, SearchProviderSettings>;
};
export interface WebFetchConfig {
  jinaEnabled?: boolean;
  /** Auto-fallback to the Wayback Machine when a direct fetch is blocked (HTTP 401/403/503) */
  waybackEnabled?: boolean;
  'min-delay'?: number;
  'max-delay'?: number;
  'cache-max-files'?: number;
  'heading-threshold'?: number;
  'content-threshold'?: number;
  'jina-timeout'?: number;
  'max-response-size'?: number;
}
/** Unified web-settings block: `henyo-web.search` + `henyo-web.fetch` */
export interface WebSettings {
  search: WebSearchConfig;
  fetch: WebFetchConfig;
}
export interface Settings {
  'henyo-web': WebSettings;
}

const HOME = os.homedir();
const SETTINGS_PATH = path.join(HOME, '.pi', 'agent', 'settings.json');

const DEFAULTS: Settings = {
  'henyo-web': {
    search: {},
    fetch: {
      jinaEnabled: true,
      waybackEnabled: true,
      'min-delay': 1000,
      'max-delay': 3000,
      'cache-max-files': 100,
      'heading-threshold': 40000,
      'content-threshold': 32000,
      'jina-timeout': 30000,
      'max-response-size': 10485760,
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
 * Validate henyo-web.search config. Currently no required fields.
 */
export function validateWebSearchConfig(config: WebSearchConfig): void {
  // No required fields — all providers work out of the box
}

/**
 * Validate henyo-web.fetch config. Currently no required fields, but this
 * provides a hook for future validation.
 */
export function validateWebFetchConfig(_config: WebFetchConfig): void {
  // No required fields for henyo-fetch — extend as needed
}

/**
 * Validate all loaded config. Throws on first error.
 */
export function validateConfig(config: Settings): void {
  validateWebSearchConfig(config['henyo-web'].search);
  validateWebFetchConfig(config['henyo-web'].fetch);
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