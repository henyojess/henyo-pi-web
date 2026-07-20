import fs from 'node:fs';
import { pickRandom, delay, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult, ProviderConfig } from './base';

const TRACE_FILE = '/tmp/jina-trace.log';
function trace(msg: string) { fs.appendFileSync(TRACE_FILE, `[${new Date().toISOString()}] ${msg}\n`); }

// ─── Jina Search Provider ────────────────────────────────────────────────────

export async function searchJina(query: string, _config?: ProviderConfig, signal?: AbortSignal): Promise<SearchResult[]> {
  return enqueue('jina', async () => {
    await delay(1000 + Math.random() * 1500);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort();
      }, { once: true });

      trace('Sending search request for: ' + query);
      const res = await fetch('https://s.jina.ai/', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'User-Agent': pickRandom(USER_AGENTS),
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ search: query }),
      });
      trace('Response status: ' + res.status + ' ok: ' + res.ok);

      if (!res.ok) {
        trace('Non-OK response, returning empty');
        return [];
      }
      const data = await res.json();
      trace('Parsed JSON, results count: ' + (data.results || []).length);
      if ((data.results || []).length === 0) {
        trace('Full response body: ' + JSON.stringify(data).substring(0, 500));
      }

      return (data.results || []).map((r: any) => ({
        title: r.title || 'Untitled',
        url: r.url || '',
        snippet: (r.content || '').replace(/<[^>]+>/g, ' ').trim().substring(0, 300),
        source: 'jina-search',
      }));
    } catch (err: any) {
      trace('Exception: ' + (err.message || err));
      return [];
    }
  });
}