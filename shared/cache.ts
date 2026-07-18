import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import { createHash } from 'node:crypto';

export interface CacheEntry<T> { data: T; timestamp: number; }

// ─── RateLimitStore ──────────────────────────────────────────────────────────

const RATE_LIMIT_DIR = path.join(os.homedir(), '.pi', 'tools-cache', 'web_search', 'rate-limit.json');

export class RateLimitStore {
  private cooldowns: Map<string, number> = new Map();
  private initialized = false;

  private getDir(): string {
    return path.dirname(RATE_LIMIT_DIR);
  }

  private ensureDir(): void {
    const dir = this.getDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): void {
    if (this.initialized) return;
    try {
      if (fs.existsSync(RATE_LIMIT_DIR)) {
        const raw = fs.readFileSync(RATE_LIMIT_DIR, 'utf8');
        const data = JSON.parse(raw) as Record<string, number>;
        this.cooldowns = new Map(Object.entries(data));
      }
    } catch {
      // Ignore parse errors, start fresh
    }
    this.initialized = true;
  }

  private save(): void {
    this.ensureDir();
    const obj: Record<string, number> = {};
    for (const [key, value] of this.cooldowns) {
      obj[key] = value;
    }
    fs.writeFileSync(RATE_LIMIT_DIR, JSON.stringify(obj), 'utf8');
  }

  /** Check if provider is currently in cooldown */
  isCooldown(provider: string): boolean {
    this.load();
    const cooldownUntil = this.cooldowns.get(provider);
    if (cooldownUntil === undefined) return false;
    if (Date.now() >= cooldownUntil) {
      this.cooldowns.delete(provider);
      this.save();
      return false;
    }
    return true;
  }

  /** Set cooldown for provider, duration in milliseconds */
  setCooldown(provider: string, durationMs: number): void {
    this.load();
    this.cooldowns.set(provider, Date.now() + durationMs);
    this.save();
  }

  /** Remove expired entries from disk */
  clearExpired(): void {
    this.load();
    const now = Date.now();
    let changed = false;
    for (const [provider, cooldownUntil] of this.cooldowns) {
      if (now >= cooldownUntil) {
        this.cooldowns.delete(provider);
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

// ─── Default cooldowns ───────────────────────────────────────────────────────

export const DEFAULT_RATE_LIMIT_COOLDOWNS: Record<string, number> = {
  duckduckgo: 600_000,   // 600s
  stackoverflow: 300_000, // 300s
  github: 300_000,       // 300s
  npm: 120_000,          // 120s
  wikipedia: 60_000,     // 60s
  jina: 120_000,         // 120s
  searxng: 120_000,      // 120s
};

export function keyToPath(dir: string, key: string): string {
  return `${dir}/${createHash('sha256').update(key).digest('hex')}.json`;
}

export function createCache<T>(dir: string, ttlSeconds: number, maxFiles?: number) {
  function ensureDir() {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  function cachePath(key: string): string {
    return keyToPath(dir, key);
  }

  function listFiles() {
    ensureDir();
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: `${dir}/${f}`,
        mtime: fs.statSync(`${dir}/${f}`).mtimeMs,
      }))
      .sort((a, b) => a.mtime - b.mtime);
  }

  function evictIfNecessary() {
    if (maxFiles === undefined) return;
    const files = listFiles();
    while (files.length >= maxFiles) {
      const oldest = files.shift();
      if (oldest) fs.unlinkSync(oldest.path);
    }
  }

  return {
    get(key: string): T | null {
      const cachePathLocal = cachePath(key);
      if (!fs.existsSync(cachePathLocal)) return null;
      try {
        const data = JSON.parse(fs.readFileSync(cachePathLocal, 'utf8')) as CacheEntry<T>;
        const age = (Date.now() - data.timestamp) / 1000;
        if (age > ttlSeconds) {
          fs.unlinkSync(cachePathLocal);
          return null;
        }
        return data.data;
      } catch {
        return null;
      }
    },

    put(key: string, data: T): void {
      ensureDir();
      evictIfNecessary();
      const entry: CacheEntry<T> = { data, timestamp: Date.now() };
      fs.writeFileSync(cachePath(key), JSON.stringify(entry), 'utf8');
    },

    evict(): void {
      evictIfNecessary();
    },

    clear(): void {
      const files = listFiles();
      for (const f of files) {
        fs.unlinkSync(f.path);
      }
    },
  };
}