import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface CacheEntry<T> { data: T; timestamp: number; }

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
    // Guard: maxFiles = 0 means "cache nothing" — without it the loop never
    // terminates (files.length is always >= 0).
    while (maxFiles > 0 && files.length >= maxFiles) {
      // Inside the loop files.length >= maxFiles > 0, so shift() is defined.
      fs.unlinkSync(files.shift()!.path);
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

function keyToPath(dir: string, key: string): string {
  return `${dir}/${createHash('sha256').update(key).digest('hex')}.json`;
}