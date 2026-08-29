import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearTraceLog, readTraceLog, shouldTrace, traceEnd, traceLog } from '../shared/search/trace';

const LOG = join(fs.mkdtempSync(join(tmpdir(), 'henyo-trace-test-')), 'trace.log');
(globalThis as Record<string, unknown>).__henyoTraceLogPath = LOG;

function unlinkResidue() {
  for (const p of [LOG, `${LOG}.1`, `${LOG}.2`, `${LOG}.3`]) {
    try {
      fs.unlinkSync(p);
    } catch {
      // no residue — expected
    }
  }
}

// Idempotency: never read or leave behind state from other runs (plan 3.3).
beforeEach(unlinkResidue);
afterEach(unlinkResidue);

describe('trace log round-trips', () => {
  it('returns empty string when no log file exists', () => {
    expect(readTraceLog()).toBe('');
  });

  it('clearTraceLog removes an existing log file', () => {
    fs.writeFileSync(LOG, 'old\n', 'utf-8');
    clearTraceLog();
    expect(fs.existsSync(LOG)).toBe(false);
    expect(readTraceLog()).toBe('');
  });

  it('clearTraceLog is a no-op when no file exists', () => {
    expect(() => clearTraceLog()).not.toThrow();
  });

  it('writes an entry line with provider, query, duration and results', () => {
    traceLog({
      provider: 'duckduckgo',
      query: 'vitest coverage',
      durationMs: 42,
      resultCount: 7,
    });
    const content = readTraceLog();
    expect(content).toContain('duckduckgo');
    expect(content).toContain('query="vitest coverage"');
    expect(content).toContain('duration=42ms');
    expect(content).toContain('results=7');
    expect(content).not.toContain('error=');
    expect(content).not.toContain('instance=');
  });

  it('includes error and instance when set', () => {
    traceLog({
      provider: 'jina',
      query: 'abort test',
      durationMs: 1000,
      resultCount: 0,
      error: 'aborted',
      instance: 'worker-2',
    });
    const content = readTraceLog();
    expect(content).toContain('error="aborted"');
    expect(content).toContain('instance="worker-2"');
  });

  it('appends entries (log accumulates lines)', () => {
    traceLog({ provider: 'a', query: 'q1', durationMs: 1, resultCount: 0 });
    traceLog({ provider: 'b', query: 'q2', durationMs: 2, resultCount: 1 });
    const lines = readTraceLog().trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]!).toContain('a');
    expect(lines[1]!).toContain('b');
  });
});

describe('trace status field', () => {
  it('renders status="…" when set (after results, before error) and omits status= when unset', () => {
    traceLog({
      provider: 'search_ddg',
      query: 'q',
      durationMs: 5,
      resultCount: 0,
      status: 'ok',
      error: 'http-429',
    });
    traceLog({ provider: 'duckduckgo', query: 'q', durationMs: 5, resultCount: 3 });
    const [first, second] = readTraceLog().trim().split('\n');
    expect(first).toContain('results=0 status="ok" error="http-429"');
    expect(second).not.toContain('status='); // back-compat format
  });
});

describe('traceEnd', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__henyoTraceConfig;
  });

  it('falls back to results=0 when the entry has no resultCount', () => {
    // `entry.resultCount ?? 0` right side (L134)
    (globalThis as Record<string, unknown>).__henyoTraceConfig = true;
    const start = Date.now() - 10;
    traceEnd('search_ddg', 'q', start, { status: 'ok' });
    const line = readTraceLog().trim();
    expect(line).toContain('results=0');
    expect(line).toContain('status="ok"');
  });

  it('respects gating: writes nothing when config is false, a line (with computed duration) when true', () => {
    (globalThis as Record<string, unknown>).__henyoTraceConfig = false;
    traceEnd('search_ddg', 'q', Date.now() - 10, { status: 'ok', resultCount: 3 });
    expect(readTraceLog()).toBe('');

    (globalThis as Record<string, unknown>).__henyoTraceConfig = true;
    const start = Date.now() - 42;
    traceEnd('search_ddg', 'q', start, { status: 'ok', resultCount: 3 });
    const line = readTraceLog().trim();
    expect(line).toContain('search_ddg query="q"');
    expect(line).toMatch(/duration=(42|43)ms/);
    expect(line).toContain('results=3');
    expect(line).toContain('status="ok"');
  });
});

describe('trace log rotation', () => {
  it('does not rotate when the log is under the 10MB limit', () => {
    // 1KB pre-existing log: early-return branches of rotateLog
    fs.writeFileSync(LOG, 'x'.repeat(1024), 'utf-8');
    traceLog({ provider: 'p', query: 'q', durationMs: 1, resultCount: 0 });
    expect(fs.existsSync(`${LOG}.1`)).toBe(false);
    const content = readTraceLog();
    expect(content.startsWith('x'.repeat(1024))).toBe(true);
    expect(content.slice(1024)).toMatch(/^\[[^\]]+\] p query="q" duration=1ms results=0\n$/);
  });

  it('rotates over-limit logs: old content moves to .1, .1 shifts to .2', () => {
    // 11MB log (over 10MB limit) plus a pre-existing .1 backup
    const big = Buffer.alloc(11 * 1024 * 1024, 0x20); // 11MB of spaces
    fs.writeFileSync(LOG, big);
    fs.writeFileSync(`${LOG}.1`, 'previous-backup-marker', 'utf-8');

    traceLog({ provider: 'p', query: 'q', durationMs: 1, resultCount: 0 });

    // new log holds only the latest line (well under 1KB)
    const fresh = readTraceLog();
    expect(fresh).toContain('p');
    expect(fresh.length).toBeLessThan(1024);
    expect(fs.statSync(LOG).size).toBeLessThan(1024);

    // old 11MB content moved to .1, old .1 shifted to .2
    expect(fs.statSync(`${LOG}.1`).size).toBe(11 * 1024 * 1024);
    expect(fs.readFileSync(`${LOG}.2`, 'utf-8')).toBe('previous-backup-marker');
  });
});

describe('shouldTrace (direct)', () => {
  it('returns true when config is true', () => {
    expect(shouldTrace(true, 'duckduckgo')).toBe(true);
  });

  it('returns membership result for array configs', () => {
    expect(shouldTrace(['jina'], 'jina')).toBe(true);
    expect(shouldTrace(['jina'], 'duckduckgo')).toBe(false);
  });

  it('returns false for false/undefined configs', () => {
    expect(shouldTrace(false, 'jina')).toBe(false);
    expect(shouldTrace(undefined, 'jina')).toBe(false);
  });
});

describe('readTraceLog failure path', () => {
  it('returns empty string when the log path is unreadable (exists but read fails)', () => {
    // a directory at the log path makes readFileSync throw EISDIR
    fs.mkdirSync(LOG, { recursive: true });
    expect(readTraceLog()).toBe('');
    fs.rmdirSync(LOG);
  });
});
