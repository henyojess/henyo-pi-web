import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as os from 'node:os';

// ─── pi-style jiti loader (same pattern as tests/index-load.test.ts) ─────────
// index.ts imports pi's packages + typebox, which are not in this project's
// node_modules — pi provides them to extensions via jiti aliases. Unlike
// index-load.test.ts (which only shape-checks the export), the factory is
// CALLED with a stub pi here to exercise the registered henyo_fetch tool.
//
// The factory call has side effects (loadConfig, rateLimitStore.clearExpired,
// cache writes) — so the extension runs under a TEMP HOME with its own
// settings.json (`henyo-search.trace: true`). This keeps the real
// ~/.pi/tools-cache/henyo_search/rate-limit.json and the real henyo_fetch
// cache untouched (the Step 5 md5-stability gate), and makes the test
// self-contained instead of depending on the real user settings.

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

const LOG = join(fs.mkdtempSync(join(os.tmpdir(), 'henyo-trace-test-')), 'trace.log');
(globalThis as Record<string, unknown>).__henyoTraceLogPath = LOG;
const RUN = Date.now(); // unique per run → guaranteed cache misses (idempotent re-runs)

function unlinkLogResidue() {
  for (const p of [LOG, `${LOG}.1`, `${LOG}.2`, `${LOG}.3`]) {
    try {
      fs.unlinkSync(p);
    } catch {
      // no residue — expected
    }
  }
}

function readLog(): string {
  try {
    return fs.readFileSync(LOG, 'utf-8');
  } catch {
    return '';
  }
}

const PAGE_HTML = `<!DOCTYPE html>
<html>
  <head><title>Fetch Trace Test Page</title></head>
  <body>
    <h1>Fetch Trace Test Page</h1>
    <p>This is the first paragraph of readable body content for the trace test.</p>
    <p>This is the second paragraph with a bit more text to extract.</p>
  </body>
</html>`;

function htmlResponse(): Response {
  return new Response(PAGE_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } });
}

describe.skipIf(!piDir)('henyo_fetch trace logging (jiti-loaded extension)', () => {
  let henyoFetchTool: any;
  let tmpHome: string | undefined;
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;

  beforeAll(async () => {
    if (!piDir || !req) return;
    // Temp HOME: the jiti-loaded modules (rate-limit store, caches, config)
    // resolve their paths from $HOME at load/call time — redirect everything
    // off the real user state.
    tmpHome = fs.mkdtempSync(join(os.tmpdir(), 'henyo-fetch-trace-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    const settingsDir = join(tmpHome, '.pi', 'agent');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ 'henyo-search': { trace: true } }),
      'utf8',
    );

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

    const registered: Record<string, any> = {};
    const pi = {
      on: () => {},
      registerCommand: () => {},
      registerTool: (tool: any) => {
        registered[tool.name] = tool;
      },
    };
    factory(pi);

    henyoFetchTool = registered['henyo_fetch'];
    expect(henyoFetchTool).toBeDefined();
    expect(typeof henyoFetchTool.execute).toBe('function');
  }, 30_000);

  afterAll(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(unlinkLogResidue);
  afterEach(() => {
    unlinkLogResidue();
    delete (globalThis as Record<string, unknown>).__henyoTraceConfig;
    vi.restoreAllMocks();
  });

  // timeout: 100ms TUI delay + 1–3s real politeness delay (jiti bypasses
  // vitest module mocks) + defuddle extraction
  it('success → henyo-fetch line with status="ok" and results > 0', async () => {
    const url = `https://example.com/fetch-trace-ok-${RUN}`;
    vi.spyOn(global, 'fetch').mockImplementation(async () => htmlResponse());
    (globalThis as Record<string, unknown>).__henyoTraceConfig = true;

    const result = await henyoFetchTool.execute(
      'tc-ok', { url, timeout: 1000 }, new AbortController().signal, undefined, {},
    );
    expect(result.details.error).toBeUndefined();
    // Extraction source varies by page size (defuddle → jina fallback → raw);
    // what matters here is that readable text came back for the trace's results=
    expect(result.content[0].text).toContain('readable body content');

    const content = readLog();
    expect(content).toContain(`henyo-fetch query="${url}"`);
    const m = content.match(/results=(\d+) status="ok"/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
  }, 30_000);

  it('second fetch of the same URL → status="cache-hit" with no re-fetch', async () => {
    const url = `https://example.com/fetch-trace-cache-${RUN}`;
    vi.spyOn(global, 'fetch').mockImplementation(async () => htmlResponse());
    (globalThis as Record<string, unknown>).__henyoTraceConfig = true;

    await henyoFetchTool.execute(
      'tc-cache-1', { url, timeout: 1000 }, new AbortController().signal, undefined, {},
    );
    const callsAfterFirst = vi.mocked(global.fetch).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await henyoFetchTool.execute(
      'tc-cache-2', { url, timeout: 1000 }, new AbortController().signal, undefined, {},
    );
    expect(second.details.cached).toBe(true);
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(callsAfterFirst);

    const lines = readLog().trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('status="ok"');
    expect(lines[1]).toContain('status="cache-hit"');
  }, 30_000);

  it('fetch rejects → status="error" error="network"', async () => {
    const url = `https://example.com/fetch-trace-error-${RUN}`;
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('fetch failed'));
    (globalThis as Record<string, unknown>).__henyoTraceConfig = true;

    const result = await henyoFetchTool.execute(
      'tc-err', { url, timeout: 1000 }, new AbortController().signal, undefined, {},
    );
    expect(result.details.errorCategory).toBe('network');

    const content = readLog();
    expect(content).toContain(`henyo-fetch query="${url}"`);
    expect(content).toContain('status="error"');
    expect(content).toContain('error="network"');
  }, 30_000);

  it('fetch gets HTTP 400 → status="error" error="bad-request"', async () => {
    const url = `https://example.com/fetch-trace-400-${RUN}`;
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response('{"error_message":"site is required"}', { status: 400, statusText: 'Bad Request' }),
    );
    (globalThis as Record<string, unknown>).__henyoTraceConfig = true;

    const result = await henyoFetchTool.execute(
      'tc-400', { url, timeout: 1000 }, new AbortController().signal, undefined, {},
    );
    expect(result.details.errorCategory).toBe('bad-request');

    const content = readLog();
    expect(content).toContain(`henyo-fetch query="${url}"`);
    expect(content).toContain('status="error"');
    expect(content).toContain('error="bad-request"');
  }, 30_000);
});
