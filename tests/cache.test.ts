import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createCache } from '../shared/cache';

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