#!/usr/bin/env node
// Configuration loader for web tools
// Reads ~/.pi/settings.json and provides defaults for missing keys

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const SETTINGS_PATH = path.join(HOME, '.pi', 'settings.json');

const DEFAULTS = {
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

let _cachedSettings = null;

/**
 * Load and merge settings from ~/.pi/settings.json with defaults.
 * Caches the result for subsequent calls.
 */
export function loadConfig() {
  if (_cachedSettings) return _cachedSettings;

  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      _cachedSettings = deepClone(DEFAULTS);
      return _cachedSettings;
    }

    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const userSettings = JSON.parse(raw);
    _cachedSettings = deepMerge(DEFAULTS, userSettings);
    return _cachedSettings;
  } catch (err) {
    // If settings file is malformed, fall back to defaults
    _cachedSettings = deepClone(DEFAULTS);
    return _cachedSettings;
  }
}

/**
 * Get a specific config section
 */
export function getConfig(section) {
  const settings = loadConfig();
  return settings[section] || {};
}

/**
 * Deep clone an object
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Deep merge two objects (user settings override defaults)
 */
function deepMerge(target, source) {
  const result = deepClone(target);
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      result[key] &&
      typeof result[key] === 'object'
    ) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}