import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitStore, DEFAULT_RATE_LIMIT_COOLDOWNS } from '../shared/rate-limit';

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

describe('RateLimitStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockFs.existsSync).mockReturnValue(true);
    vi.mocked(mockFs.readFileSync).mockReturnValue('{}');
    vi.mocked(mockFs.writeFileSync).mockReturnValue();
    vi.mocked(mockFs.mkdirSync).mockReturnValue();
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

    it('creates the rate-limit directory when it is missing', () => {
      // existsSync false for both the file (load skips) and the dir (ensureDir mkdir)
      vi.mocked(mockFs.existsSync).mockReturnValue(false);
      const store = new RateLimitStore();
      store.setCooldown('duckduckgo', 600_000);

      expect(mockFs.mkdirSync).toHaveBeenCalled();
      // written to the rate-limit file path
      const call = vi.mocked(mockFs.writeFileSync).mock.calls?.[0];
      expect(call?.[1]).toContain('duckduckgo');
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

  describe('remainingMs', () => {
    it('returns 0 when no cooldown is set', () => {
      vi.mocked(mockFs.readFileSync).mockReturnValue('{}');
      const store = new RateLimitStore();
      expect(store.remainingMs('duckduckgo')).toBe(0);
    });

    it('returns positive remaining time within cooldown', () => {
      vi.mocked(mockFs.readFileSync).mockReturnValue(
        JSON.stringify({ duckduckgo: Date.now() + 600_000 })
      );
      const store = new RateLimitStore();
      const remaining = store.remainingMs('duckduckgo');
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(600_000);
    });

    it('returns 0 and removes entry when cooldown has expired', () => {
      vi.mocked(mockFs.readFileSync).mockReturnValue(
        JSON.stringify({ duckduckgo: Date.now() - 1000 })
      );
      const store = new RateLimitStore();
      expect(store.remainingMs('duckduckgo')).toBe(0);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse(vi.mocked(mockFs.writeFileSync).mock.calls?.[0][1] as string);
      expect(written).not.toHaveProperty('duckduckgo');
    });

    it('re-reads the file on every call (external writes visible without restart)', () => {
      // Simulates a long-lived process: one store instance, file starts empty
      vi.mocked(mockFs.readFileSync).mockReturnValue('{}');
      const store = new RateLimitStore();
      expect(store.remainingMs('github')).toBe(0);

      // Another process writes a cooldown to the file
      vi.mocked(mockFs.readFileSync).mockReturnValue(
        JSON.stringify({ github: Date.now() + 300_000 })
      );
      expect(store.remainingMs('github')).toBeGreaterThan(0);
    });
  });
});

describe('DEFAULT_RATE_LIMIT_COOLDOWNS', () => {
  it('has all expected providers', () => {
    expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('duckduckgo');
    expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('stackoverflow');
    expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('github');
    expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('npm');
    expect(DEFAULT_RATE_LIMIT_COOLDOWNS).toHaveProperty('wikipedia');
  });

  it('has correct cooldown values in milliseconds', () => {
    expect(DEFAULT_RATE_LIMIT_COOLDOWNS.duckduckgo).toBe(600_000);
    expect(DEFAULT_RATE_LIMIT_COOLDOWNS.stackoverflow).toBe(300_000);
    expect(DEFAULT_RATE_LIMIT_COOLDOWNS.github).toBe(300_000);
    expect(DEFAULT_RATE_LIMIT_COOLDOWNS.npm).toBe(120_000);
    expect(DEFAULT_RATE_LIMIT_COOLDOWNS.wikipedia).toBe(60_000);
  });

  it('all values are positive numbers', () => {
    for (const [provider, value] of Object.entries(DEFAULT_RATE_LIMIT_COOLDOWNS)) {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThan(0);
    }
  });
});