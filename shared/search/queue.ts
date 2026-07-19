import { delay } from '../user-agents';
import { SearchResult } from './providers/base';

// ─── Per-provider serialization queue (FIFO) ────────────────────────────────

interface QueueEntry {
  fn: () => Promise<SearchResult[]>;
  resolve: (value: SearchResult[]) => void;
  reject: (reason: any) => void;
}

const PROVIDER_QUEUES = new Map<string, QueueEntry[]>();
let PROVIDER_RUNNING = new Set<string>();

/**
 * Serialize provider calls: only one call runs at a time per provider.
 * Concurrent calls are queued and processed in FIFO order with a 2-5s delay between them.
 */
export async function enqueue(providerName: string, fn: () => Promise<SearchResult[]>): Promise<SearchResult[]> {
  return new Promise<SearchResult[]>((resolve, reject) => {
    const entry: QueueEntry = { fn, resolve, reject };
    const queue = PROVIDER_QUEUES.get(providerName) || [];

    if (queue.length === 0 && !PROVIDER_RUNNING.has(providerName)) {
      // First call: fire immediately — add to queue so processNext can process it
      queue.push(entry);
      PROVIDER_QUEUES.set(providerName, queue);
      PROVIDER_RUNNING.add(providerName);
      processNext(providerName).catch(reject);
    } else {
      // Queue the call
      queue.push(entry);
      PROVIDER_QUEUES.set(providerName, queue);
    }
  });
}

async function processNext(providerName: string): Promise<void> {
  const queue = PROVIDER_QUEUES.get(providerName);
  if (!queue || queue.length === 0) {
    PROVIDER_RUNNING.delete(providerName);
    return;
  }

  const entry = queue.shift()!;
  try {
    const results = await entry.fn();
    entry.resolve(results);
  } catch (err) {
    entry.reject(err);
  }

  // Random delay between queued calls: 2-5 seconds
  await delay(2000 + Math.random() * 3000);
  await processNext(providerName);
}