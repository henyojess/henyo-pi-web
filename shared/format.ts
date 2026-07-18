import type { SearchResult } from './search/providers';

export function normalizeUrl(u: string): string {
  return u.toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/www\./, 'https://');
}

// ─── BM25 ranking ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'it', 'its', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'what', 'which',
  'who', 'whom', 'how', 'when', 'where', 'why', 'if', 'not', 'no', 'nor',
]);

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9+\-_.]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

export function bm25Score(query: string, title: string, snippet: string): number {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return 0;

  const titleTokens = tokenize(title);
  const snippetTokens = tokenize(snippet);
  const allTokens = [...titleTokens, ...snippetTokens];

  let score = 0;
  const k1 = 1.5;  // BM25 parameter
  const b = 0.75;  // BM25 parameter
  const avgLen = allTokens.length || 1;

  for (const term of queryTerms) {
    // TF in title (weighted 2x)
    let titleCount = 0;
    for (const t of titleTokens) {
      if (t === term) titleCount++;
    }
    if (titleCount > 0) {
      const tf = titleCount / (titleCount + k1 * (1 - b + b * (titleTokens.length / avgLen)));
      score += tf * 2.0; // Title matches weighted higher
    }

    // TF in snippet
    let snippetCount = 0;
    for (const t of snippetTokens) {
      if (t === term) snippetCount++;
    }
    if (snippetCount > 0) {
      const tf = snippetCount / (snippetCount + k1 * (1 - b + b * (snippetTokens.length / avgLen)));
      score += tf;
    }
  }

  return score;
}

/**
 * Diversify results by domain: cap results per domain to avoid single-source dominance.
 * Groups by domain, takes maxPerDomain from each, then relaxes if under the cap.
 */
export function diversifyByDomain(results: SearchResult[], maxPerDomain = 2): SearchResult[] {
  if (results.length <= maxPerDomain) return results;

  // Group by domain, preserving order
  const byDomain = new Map<string, SearchResult[]>();
  const noDomain: SearchResult[] = [];

  for (const r of results) {
    const domain = r.domain || '__no_domain__';
    if (domain === '__no_domain__') {
      noDomain.push(r);
    } else {
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain)!.push(r);
    }
  }

  // Take maxPerDomain from each domain
  const capped: SearchResult[] = [];
  for (const [domain, items] of byDomain) {
    capped.push(...items.slice(0, maxPerDomain));
  }
  capped.push(...noDomain);

  // If we still have room, take remaining from any domain
  if (capped.length < maxPerDomain * 10 && results.length > capped.length) {
    const relaxed = new Map<string, number>();
    for (const r of capped) {
      const domain = r.domain || '__no_domain__';
      relaxed.set(domain, (relaxed.get(domain) || 0) + 1);
    }
    for (const r of results) {
      if (capped.includes(r)) continue;
      const domain = r.domain || '__no_domain__';
      const count = relaxed.get(domain) || 0;
      if (count < maxPerDomain * 3) { // Allow up to 3x per domain when relaxing
        capped.push(r);
        relaxed.set(domain, count + 1);
      }
    }
  }

  return capped;
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
    if (r.domain) line += `\n   Domain: ${r.domain}`;
    return line;
  }).join('\n\n');
}