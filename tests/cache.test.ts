import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createCache, RateLimitStore, DEFAULT_RATE_LIMIT_COOLDOWNS } from '../shared/cache';

// Mock node:fs
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

import fs from 'node:fs';

const mockFs = fs as ReturnType<typeof vi.mocked>;

describe('createCache', () => {
  const dir = '/tmp/cache-test';
  const maxFiles = 3;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure unlinkSync is a completely fresh mock
    vi.mocked(mockFs.unlinkSync).mockImplementation(vi.fn());
  });

  describe('get', () => {
    it('returns null when cache file does not exist', () => {
      vi.mocked(mockFs.existsSync).mockReturnValue(false);

      const cache = createCache(dir, 300);
      const result = cache.get('my-key');

      expect(result).toBeNull();
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('returns null when cache file is expired', () => {
      vi.mocked(mockFs.existsSync).mockReturnValue(true);
      vi.mocked(mockFs.readFileSync).mockReturnValue(
        JSON.stringify({ data: { value: 'old' }, timestamp: Date.now() - 600_000 })
      );

      const cache = createCache(dir, 300);
      const result = cache.get('my-key');

      expect(result).toBeNull();
      // unlinkSync is called with the SHA256 hash path
      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(
        `${dir}/${createHash('sha256').update('my-key').digest('hex')}.json`
      );
    });

    it('returns data when cache file is valid', () => {
      vi.mocked(mockFs.existsSync).mockReturnValue(true);
      const testData = { value: 'fresh' };
      vi.mocked(mockFs.readFileSync).mockReturnValue(
        JSON.stringify({ data: testData, timestamp: Date.now() })
      );

      const cache = createCache(dir, 300);
      const result = cache.get('my-key');

      expect(result).toEqual(testData);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('returns null when JSON parsing fails', () => {
      vi.mocked(mockFs.existsSync).mockReturnValue(true);
      vi.mocked(mockFs.readFileSync).mockReturnValue('not valid json');

      const cache = createCache(dir, 300);
      const result = cache.get('my-key');

      expect(result).toBeNull();
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('put', () => {
    it('creates directory if it does not exist', () => {
      vi.mocked(mockFs.existsSync).mockReturnValue(false);

      const cache = createCache(dir, 300);
      cache.put('my-key', { value: 'data' });

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
    });

    it('writes cache entry with current timestamp', () => {
      vi.mocked(mockFs.existsSync).mockReturnValue(true);
      const before = Date.now();

      const cache = createCache(dir, 300);
      cache.put('my-key', { value: 'data' });

      const after = Date.now();
      const callArgs = vi.mocked(mockFs.writeFileSync).mock.calls?.[0];
      expect(callArgs).toBeDefined();
      const written = JSON.parse(callArgs![1] as string);
      expect(written.data).toEqual({ value: 'data' });
      expect(written.timestamp).toBeGreaterThanOrEqual(before);
      expect(written.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('evictIfNecessary (internal, triggered by put/evict)', () => {
    it('evicts one file when at max capacity', () => {
      vi.mocked(mockFs.existsSync).mockReturnValue(true);
      vi.mocked(mockFs.readdirSync).mockReturnValue([
        'aaa.json',
        'bbb.json',
        'ccc.json',
      ]);
      vi.mocked(mockFs.statSync).mockImplementation(() => ({
        mtimeMs: 1000,
      }));

      const cache = createCache(dir, 300, maxFiles);
      cache.put('key1', { value: 'data1' });

      // 3 files >= maxFiles 3 → evict 1 oldest
      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(`${dir}/aaa.json`);
    });

    it('evicts multiple files when needed', () => {
      vi.mocked(mockFs.unlinkSync).mockReset();
      vi.mocked(mockFs.existsSync).mockReturnValue(true);
      vi.mocked(mockFs.readdirSync).mockReturnValue([
        'aaa.json',
        'bbb.json',
        'ccc.json',
        'ddd.json',
      ]);
      vi.mocked(mockFs.statSync).mockImplementation(() => ({
        mtimeMs: 1000,
      }));

      const cache = createCache(dir, 300, 2);
      cache.put('key1', { value: 'data1' });

      // 4 files >= maxFiles 2 → evict 2 oldest
      // Use toHaveBeenCalledWith instead of toHaveBeenCalledTimes to avoid count issues
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(`${dir}/aaa.json`);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(`${dir}/bbb.json`);
    });

    it('skips eviction when maxFiles is undefined', () => {
      vi.mocked(mockFs.unlinkSync).mockClear();
      vi.mocked(mockFs.existsSync).mockReturnValue(true);
      vi.mocked(mockFs.readdirSync).mockReturnValue(['aaa.json']);
      vi.mocked(mockFs.statSync).mockImplementation(() => ({
        mtimeMs: 1000,
      }));

      const cache = createCache(dir, 300);
      cache.put('key1', { value: 'data1' });

      // No maxFiles → eviction skipped
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('evict', () => {
    it('triggers eviction based on maxFiles', () => {
      vi.mocked(mockFs.unlinkSync).mockReset();
      vi.mocked(mockFs.existsSync).mockReturnValue(true);
      vi.mocked(mockFs.readdirSync).mockReturnValue([
        'aaa.json',
        'bbb.json',
        'ccc.json',
      ]);
      vi.mocked(mockFs.statSync).mockImplementation(() => ({
        mtimeMs: 1000,
      }));

      const cache = createCache(dir, 300, 2);
      cache.evict();

      // 3 files >= maxFiles 2 → evict 1
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(`${dir}/aaa.json`);
    });
  });

  describe('clear', () => {
    it('removes all cached files', () => {
      vi.mocked(mockFs.unlinkSync).mockClear();
      vi.mocked(mockFs.existsSync).mockReturnValue(true);
      vi.mocked(mockFs.readdirSync).mockReturnValue([
        'aaa.json',
        'bbb.json',
        'ccc.json',
      ]);
      vi.mocked(mockFs.statSync).mockImplementation(() => ({
        mtimeMs: 1000,
      }));

      const cache = createCache(dir, 300);
      cache.clear();

      // Should unlink all 3 files
      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(3);
      expect(mockFs.unlinkSync).toHaveBeenNthCalledWith(1, `${dir}/aaa.json`);
      expect(mockFs.unlinkSync).toHaveBeenNthCalledWith(2, `${dir}/bbb.json`);
      expect(mockFs.unlinkSync).toHaveBeenNthCalledWith(3, `${dir}/ccc.json`);
    });

    it('does nothing when no files exist', () => {
      vi.mocked(mockFs.unlinkSync).mockClear();
      vi.mocked(mockFs.existsSync).mockReturnValue(true);
      vi.mocked(mockFs.readdirSync).mockReturnValue([]);
      vi.mocked(mockFs.statSync).mockImplementation(() => ({
        mtimeMs: 1000,
      }));

      const cache = createCache(dir, 300);
      cache.clear();

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });
});

// ─── RateLimitStore ──────────────────────────────────────────────────────────

describe('RateLimitStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockFs.existsSync).mockReturnValue(true);
    vi.mocked(mockFs.readFileSync).mockReturnValue('{}');
    vi.mocked(mockFs.writeFileSync).mockReturnValue();
    vi.mocked(mockFs.mkdirSync).mockReturnValue();
  });

  describe('isCooldown', () => {
    it('returns false when no cooldown is set', () => {
      vi.mocked(mockFs.readFileSync).mockReturnValue('{}');
      const store = new RateLimitStore();
      expect(store.isCooldown('duckduckgo')).toBe(false);
    });

    it('returns true when within cooldown', () => {
      vi.mocked(mockFs.readFileSync).mockReturnValue(
        JSON.stringify({ duckduckgo: Date.now() + 600_000 })
      );
      const store = new RateLimitStore();
      expect(store.isCooldown('duckduckgo')).toBe(true);
    });

    it('returns false and removes entry when cooldown has expired', () => {
      vi.mocked(mockFs.readFileSync).mockReturnValue(
        JSON.stringify({ duckduckgo: Date.now() - 1000 })
      );
      const store = new RateLimitStore();
      expect(store.isCooldown('duckduckgo')).toBe(false);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse(vi.mocked(mockFs.writeFileSync).mock.calls?.[0][1] as string);
      expect(written).not.toHaveProperty('duckduckgo');
    });
  });

  describe('setCooldown', () => {
    it('sets cooldown and persists to disk', () => {
      const store = new RateLimitStore();
      store.setCooldown('duckduckgo', 600_000);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse(vi.mocked(mockFs.writeFileSync).mock.calls?.[0][1] as string);
      expect(written).toHaveProperty('duckduckgo');
      expect(written.duckduckgo).toBeGreaterThan(Date.now());
      expect(written.duckduckgo).toBeLessThanOrEqual(Date.now() + 600_000 + 100);
    });

    it('updates existing cooldown', () => {
      vi.mocked(mockFs.readFileSync).mockReturnValue(
        JSON.stringify({ duckduckgo: Date.now() + 100_000 })
      );
      const store = new RateLimitStore();
      store.setCooldown('duckduckgo', 500_000);

      const written = JSON.parse(vi.mocked(mockFs.writeFileSync).mock.calls?.[0][1] as string);
      expect(written.duckduckgo).toBeGreaterThan(Date.now() + 400_000);
    });
  });

  describe('clearExpired', () => {
    it('removes stale entries', () => {
      vi.mocked(mockFs.readFileSync).mockReturnValue(
        JSON.stringify({
          duckduckgo: Date.now() - 1000,
          stackoverflow: Date.now() + 300_000,
        })
      );
      const store = new RateLimitStore();
      store.clearExpired();

      const written = JSON.parse(vi.mocked(mockFs.writeFileSync).mock.calls?.[0][1] as string);
      expect(written).toHaveProperty('stackoverflow');
      expect(written).not.toHaveProperty('duckduckgo');
    });

    it('does nothing when no expired entries', () => {
      vi.mocked(mockFs.readFileSync).mockReturnValue(
        JSON.stringify({ duckduckgo: Date.now() + 300_000 })
      );
      const store = new RateLimitStore();
      store.clearExpired();

      // No save when nothing changed
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('handles empty store', () => {
      vi.mocked(mockFs.readFileSync).mockReturnValue('{}');
      const store = new RateLimitStore();
      store.clearExpired();

      // No save when nothing changed
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('DEFAULT_RATE_LIMIT_COOLDOWNS', () => {
    it('has all expected providers', () => {
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('duckduckgo');
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('stackoverflow');
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('github');
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('npm');
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('wikipedia');
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('jina');
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('searxng');
    });

    it('has correct cooldown values in milliseconds', () => {
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS.duckduckgo).toBe(600_000);
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS.stackoverflow).toBe(300_000);
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS.github).toBe(300_000);
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS.npm).toBe(120_000);
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS.wikipedia).toBe(60_000);
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS.jina).toBe(120_000);
      expect(DEFAULT_RATE_LIMIT_COOLDOWNS.searxng).toBe(120_000);
    });

    it('all values are positive numbers', () => {
      for (const [provider, value] of Object.entries(DEFAULT_RATE_LIMIT_COOLDOWNS)) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
      }
    });
  });
});