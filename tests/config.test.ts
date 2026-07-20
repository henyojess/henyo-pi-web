import { loadConfig } from '../shared/config';
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
    expect(config['henyo-search'].contexts?.coding?.duckduckgo?.priority).toBe(1);
    expect(config['henyo-search'].contexts?.general?.wikipedia?.priority).toBe(1);

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
        contexts: {
          coding: {
            npm: { priority: 0 },
          },
        },
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
    expect(config['henyo-search'].contexts?.coding?.npm?.priority).toBe(0);

    // Preserved defaults
    expect(config['henyo-fetch']['max-delay']).toBe(3000);
    expect(config['henyo-fetch']['cache-max-files']).toBe(100);
    expect(config['henyo-search'].contexts?.coding?.duckduckgo?.priority).toBe(1);
    expect(config['henyo-search'].contexts?.general?.wikipedia?.priority).toBe(1);

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

  it('loads rate-limit-cooldowns from user settings', async () => {
    const origExistsSync = fs.existsSync;
    const origReadFileSync = fs.readFileSync;

    const customSettings = {
      'henyo-search': {
        'rate-limit-cooldowns': { duckduckgo: 900_000 },
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

    expect(config['henyo-search']['rate-limit-cooldowns']).toEqual({ duckduckgo: 900_000 });

    fs.existsSync = origExistsSync;
    fs.readFileSync = origReadFileSync;
  });

  it('loads max-per-domain from user settings', async () => {
    const origExistsSync = fs.existsSync;
    const origReadFileSync = fs.readFileSync;

    const customSettings = {
      'henyo-search': {
        'max-per-domain': 5,
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

    expect(config['henyo-search']['max-per-domain']).toBe(5);

    fs.existsSync = origExistsSync;
    fs.readFileSync = origReadFileSync;
  });

  it('loads ranking-enabled from user settings', async () => {
    const origExistsSync = fs.existsSync;
    const origReadFileSync = fs.readFileSync;

    const customSettings = {
      'henyo-search': {
        'ranking-enabled': false,
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

    expect(config['henyo-search']['ranking-enabled']).toBe(false);

    fs.existsSync = origExistsSync;
    fs.readFileSync = origReadFileSync;
  });

  it('loads api-key from user settings', async () => {
    const origExistsSync = fs.existsSync;
    const origReadFileSync = fs.readFileSync;

    const customSettings = {
      'henyo-search': {
        'api-key': 'my-secret-key',
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

    expect(config['henyo-search']['api-key']).toBe('my-secret-key');

    fs.existsSync = origExistsSync;
    fs.readFileSync = origReadFileSync;
  });
});