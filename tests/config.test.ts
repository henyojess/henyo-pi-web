import { loadConfig, validateConfig, type Settings } from '../shared/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('loadConfig', () => {
  const settingsPath = path.join(os.homedir(), '.pi', 'settings.json');

  afterEach(() => {
    // Reset the cached settings between tests by deleting the module's cache
    // Since we can't access _cachedSettings directly, we reload the module
    vi.resetModules();
  });

  it('returns defaults when settings file does not exist', async () => {
    const origExistsSync = fs.existsSync;
    fs.existsSync = vi.fn((p: string) => {
      if (p === settingsPath) return false;
      return origExistsSync(p);
    });

    const { loadConfig: freshLoad } = await import('../shared/config.ts');
    const config = freshLoad();

    expect(config['henyo-fetch'].jinaEnabled).toBe(true);
    expect(config['henyo-fetch']['min-delay']).toBe(1000);
    expect(config['henyo-fetch']['max-delay']).toBe(3000);
    expect(config['henyo-search']).toEqual({});

    fs.existsSync = origExistsSync;
  });

  it('merges user settings with defaults', async () => {
    const origExistsSync = fs.existsSync;
    const origReadFileSync = fs.readFileSync;

    const customSettings = {
      'henyo-fetch': {
        'min-delay': 500,
        jinaEnabled: false,
      },
      'henyo-search': {
        trace: ['duckduckgo'],
      },
    };

    fs.existsSync = vi.fn((p: string) => {
      if (p === settingsPath) return true;
      return origExistsSync(p);
    });

    fs.readFileSync = vi.fn((p: string, enc: string) => {
      if (p === settingsPath) return JSON.stringify(customSettings);
      return origReadFileSync(p, enc);
    });

    const { loadConfig: freshLoad } = await import('../shared/config.ts');
    const config = freshLoad();

    // User overrides
    expect(config['henyo-fetch']['min-delay']).toBe(500);
    expect(config['henyo-fetch'].jinaEnabled).toBe(false);
    expect(config['henyo-search'].trace).toEqual(['duckduckgo']);

    // Preserved defaults
    expect(config['henyo-fetch']['max-delay']).toBe(3000);
    expect(config['henyo-fetch']['cache-max-files']).toBe(100);

    fs.existsSync = origExistsSync;
    fs.readFileSync = origReadFileSync;
  });

  it('returns defaults on parse error', async () => {
    const origExistsSync = fs.existsSync;
    const origReadFileSync = fs.readFileSync;

    fs.existsSync = vi.fn((p: string) => {
      if (p === settingsPath) return true;
      return origExistsSync(p);
    });

    fs.readFileSync = vi.fn((p: string, enc: string) => {
      if (p === settingsPath) return 'not valid json';
      return origReadFileSync(p, enc);
    });

    const { loadConfig: freshLoad } = await import('../shared/config.ts');
    const config = freshLoad();

    expect(config['henyo-fetch'].jinaEnabled).toBe(true);
    expect(config['henyo-fetch']['min-delay']).toBe(1000);

    fs.existsSync = origExistsSync;
    fs.readFileSync = origReadFileSync;
  });

  it('caches settings on second call', async () => {
    const origExistsSync = fs.existsSync;
    fs.existsSync = vi.fn((p: string) => {
      if (p === settingsPath) return false;
      return origExistsSync(p);
    });

    const { loadConfig: freshLoad } = await import('../shared/config.ts');
    const config1 = freshLoad();
    const config2 = freshLoad();
    expect(config1).toBe(config2); // same reference

    fs.existsSync = origExistsSync;
  });

  it('loads api-key from user settings', async () => {
    const origExistsSync = fs.existsSync;
    const origReadFileSync = fs.readFileSync;

    const customSettings = {
      'henyo-search': {
        providers: { stackoverflow: { 'api-key': 'my-secret-key' } },
      },
    };

    fs.existsSync = vi.fn((p: string) => {
      if (p === settingsPath) return true;
      return origExistsSync(p);
    });

    fs.readFileSync = vi.fn((p: string, enc: string) => {
      if (p === settingsPath) return JSON.stringify(customSettings);
      return origReadFileSync(p, enc);
    });

    const { loadConfig: freshLoad } = await import('../shared/config.ts');
    const config = freshLoad();

    expect(config['henyo-search'].providers?.stackoverflow?.['api-key']).toBe('my-secret-key');

    fs.existsSync = origExistsSync;
    fs.readFileSync = origReadFileSync;
  });

  it('deep-merges nested providers.stackoverflow.api-key over defaults', async () => {
    const origExistsSync = fs.existsSync;
    const origReadFileSync = fs.readFileSync;

    const customSettings = {
      'henyo-search': {
        providers: { stackoverflow: { 'api-key': 'x' } },
      },
    };

    fs.existsSync = vi.fn((p: string) => {
      if (p === settingsPath) return true;
      return origExistsSync(p);
    });

    fs.readFileSync = vi.fn((p: string, enc: string) => {
      if (p === settingsPath) return JSON.stringify(customSettings);
      return origReadFileSync(p, enc);
    });

    const { loadConfig: freshLoad } = await import('../shared/config.ts');
    const config = freshLoad();

    expect(config['henyo-search'].providers?.stackoverflow?.['api-key']).toBe('x');

    fs.existsSync = origExistsSync;
    fs.readFileSync = origReadFileSync;
  });
});

describe('validateConfig', () => {
  it('accepts a fully-populated settings object without throwing', () => {
    const config: Settings = {
      'henyo-search': {
        trace: true,
        providers: { stackoverflow: { 'api-key': 'x' } },
      },
      'henyo-fetch': { jinaEnabled: true, 'max-response-size': 1_048_576 },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('runs both section validators on an empty config (no-op hooks today)', () => {
    // validators are currently no-op hooks: even a junk shape does not throw
    expect(() => validateConfig({ 'henyo-search': {}, 'henyo-fetch': {} } as Settings)).not.toThrow();
  });
});