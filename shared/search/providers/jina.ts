import * as fs from 'node:fs';
import { pickRandom, USER_AGENTS } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult } from './base';
import { shouldTrace } from '../trace';

function trace(msg: string): void {
  const traceConfig = (globalThis as any).__henyoTraceConfig;
  if (shouldTrace(traceConfig, 'jina')) {
    try {
      fs.appendFileSync('/tmp/jina-trace.log', `[${new Date().toISOString()}] ${msg}\n`);
    } catch {
      // Silently fail — trace logging should never break the provider
    }
  }
}

// ─── Jina Search Provider ────────────────────────────────────────────────────

export async function searchJina(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  return enqueue('jina', async () => {
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
        domain: 'jina.ai',
        source: 'jina-search',
      }));
    } catch (err: any) {
      trace('Exception: ' + (err.message || err));
      return [];
    }
  });
}