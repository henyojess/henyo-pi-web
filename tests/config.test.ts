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

    expect(config['web-fetch'].jinaEnabled).toBe(true);
    expect(config['web-fetch']['min-delay']).toBe(1000);
    expect(config['web-fetch']['max-delay']).toBe(3000);
    expect(config['web-search'].contexts?.coding?.duckduckgo?.priority).toBe(1);
    expect(config['web-search'].contexts?.general?.wikipedia?.priority).toBe(1);

    fs.existsSync = origExistsSync;
  });

  it('merges user settings with defaults', async () => {
    const origExistsSync = fs.existsSync;
    const origReadFileSync = fs.readFileSync;

    const customSettings = {
      'web-fetch': {
        'min-delay': 500,
        jinaEnabled: false,
      },
      'web-search': {
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
    expect(config['web-fetch']['min-delay']).toBe(500);
    expect(config['web-fetch'].jinaEnabled).toBe(false);
    expect(config['web-search'].contexts?.coding?.npm?.priority).toBe(0);

    // Preserved defaults
    expect(config['web-fetch']['max-delay']).toBe(3000);
    expect(config['web-fetch']['cache-max-files']).toBe(100);
    expect(config['web-search'].contexts?.coding?.duckduckgo?.priority).toBe(1);
    expect(config['web-search'].contexts?.general?.wikipedia?.priority).toBe(1);

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

    expect(config['web-fetch'].jinaEnabled).toBe(true);
    expect(config['web-fetch']['min-delay']).toBe(1000);

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
});