import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Load index.ts through the same loader pi uses (jiti + aliases — see pi's
// dist/core/extensions/loader.js) so a syntactically broken extension entry
// fails the suite the way it fails pi's /reload. `typebox` and the pi
// packages are not in this project's node_modules — pi provides them to
// extensions via jiti aliases, so alias to pi's own install. Skips when pi's
// global install is not found (e.g. plain CI without pi).
//
// The check mirrors pi's loader itself: the default export must be a
// function. The factory is NOT called — running it has real side effects
// (config, rate-limit store), and pi's loader only asserts the export shape.

const PI_PKG = '@earendil-works/pi-coding-agent';

function findPiInstall(): string | null {
  const candidates = [
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    join(homedir(), '.npm-global/lib/node_modules'),
    join(homedir(), '.local/share/node_modules'),
    join(homedir(), '.bun/install/global/node_modules'),
  ];
  for (const root of candidates) {
    const piDir = join(root, PI_PKG);
    if (existsSync(join(piDir, 'dist', 'core', 'extensions', 'loader.js'))) {
      return piDir;
    }
  }
  return null;
}

const piDir = findPiInstall();
const req = piDir ? createRequire(join(piDir, 'dist', 'core', 'extensions', 'loader.js')) : null;

describe('index.ts loads through pi-style jiti', () => {
  // 30s: the first (cold) run imports pi's full dist/index.js through jiti,
  // which can take several seconds on a cold cache.
  it.skipIf(!piDir)('parses, resolves, and exports a factory function', async () => {
    if (!piDir || !req) return;
    const { createJiti } = req('jiti');
    const jiti = createJiti(join(piDir, 'dist', 'core', 'extensions', 'loader.js'), {
      moduleCache: false,
      fsCache: false,
      alias: {
        'typebox': req.resolve('typebox'),
        '@earendil-works/pi-coding-agent': join(piDir, 'dist', 'index.js'),
        '@earendil-works/pi-tui': req.resolve('@earendil-works/pi-tui'),
      },
    });
    const factory = await jiti.import(fileURLToPath(new URL('../index.ts', import.meta.url)), {
      default: true,
    });
    expect(typeof factory).toBe('function');
  }, 30_000);
});
