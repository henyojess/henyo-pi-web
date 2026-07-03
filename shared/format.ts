import type { SearchResult } from './search/providers';

export function normalizeUrl(u: string): string {
  return u.toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/www\./, 'https://');
}

export function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  return results.map((r, i) => {
    let line = `${i + 1}. ${r.title}`;
    line += `\n   URL: ${r.url}`;
    if (r.snippet) line += `\n   ${r.snippet.substring(0, 200)}`;
    if (r.source) line += `\n   Source: ${r.source}`;
    return line;
  }).join('\n\n');
}