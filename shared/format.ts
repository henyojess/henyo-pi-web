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

  // ── IDF computation ──────────────────────────────────────────────────────
  // Document frequency: how many query terms appear in this document.
  // Since we only have one document, df ∈ {0, 1}. We use smoothed IDF.
  const docFreq = new Map<string, number>();
  const allUniqueTokens = new Set(allTokens);
  for (const term of queryTerms) {
    docFreq.set(term, allUniqueTokens.has(term) ? 1 : 0);
  }

  let score = 0;
  const k1 = 1.5;  // BM25 parameter
  const b = 0.75;  // BM25 parameter
  const avgLen = allTokens.length || 1;

  for (const term of queryTerms) {
    const df = docFreq.get(term) ?? 0;
    // Smoothed IDF: log(1 + (N - df + 0.5) / (df + 0.5)), where N = 1 (single doc)
    const idf = Math.log(1 + (1 - df + 0.5) / (df + 0.5));

    // TF in title (weighted 2x)
    let titleCount = 0;
    for (const t of titleTokens) {
      if (t === term) titleCount++;
    }
    if (titleCount > 0) {
      const tf = titleCount / (titleCount + k1 * (1 - b + b * (titleTokens.length / avgLen)));
      score += tf * idf * 2.0; // Title matches weighted higher
    }

    // TF in snippet
    let snippetCount = 0;
    for (const t of snippetTokens) {
      if (t === term) snippetCount++;
    }
    if (snippetCount > 0) {
      const tf = snippetCount / (snippetCount + k1 * (1 - b + b * (snippetTokens.length / avgLen)));
      score += tf * idf;
    }
  }

  return score;
}

// ─── Corpus-level BM25 ranking ───────────────────────────────────────────────

/**
 * Score and rank results corpus-wide. Tokenizes the query once,
 * computes IDF from document frequency across ALL results, then
 * scores each result and sorts descending by score.
 */
export function rankResults(query: string, results: SearchResult[]): SearchResult[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || results.length === 0) return results;

  const N = results.length;

  // ── Corpus-level document frequency ────────────────────────────────────
  // For each query term, count how many results contain it (df)
  const docFreq = new Map<string, number>();
  for (const term of queryTerms) {
    docFreq.set(term, 0);
  }

  const resultScores: number[] = new Array(N);
  const k1 = 1.5;
  const b = 0.75;

  interface ResultTokens {
    titleTokens: string[];
    snippetTokens: string[];
    tokenSet: Set<string>;
    titleCountMap: Map<string, number>;
    snippetCountMap: Map<string, number>;
  }

  // First pass: collect token data per result, compute df
  const resultTokens: ResultTokens[] = [];
  for (let i = 0; i < N; i++) {
    const r = results[i];
    const titleTokens = tokenize(r.title);
    const snippetTokens = tokenize(r.snippet || '');
    const allTokens = [...titleTokens, ...snippetTokens];
    const tokenSet = new Set(allTokens);

    // Pre-build term-count Maps for O(1) lookup
    const titleCountMap = new Map<string, number>();
    for (const t of titleTokens) {
      titleCountMap.set(t, (titleCountMap.get(t) ?? 0) + 1);
    }
    const snippetCountMap = new Map<string, number>();
    for (const t of snippetTokens) {
      snippetCountMap.set(t, (snippetCountMap.get(t) ?? 0) + 1);
    }

    resultTokens.push({ titleTokens, snippetTokens, tokenSet, titleCountMap, snippetCountMap });

    for (const term of queryTerms) {
      if (tokenSet.has(term)) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
    }
  }

  // Second pass: score each result (reuse token data from pass 1)
  for (let i = 0; i < N; i++) {
    const r = results[i];
    const rt = resultTokens[i]!;
    const titleTokens = rt.titleTokens;
    const snippetTokens = rt.snippetTokens;
    const allTokens = [...titleTokens, ...snippetTokens];
    const tokenSet = rt.tokenSet;
    const len = allTokens.length || 1;

    let score = 0;

    for (const term of queryTerms) {
      const df = docFreq.get(term) ?? 0;
      // Smoothed corpus-level IDF
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

      // TF in title (weighted 2x) — O(1) map lookup
      const titleCount = rt.titleCountMap.get(term) ?? 0;
      if (titleCount > 0) {
        const tf = titleCount / (titleCount + k1 * (1 - b + b * (titleTokens.length / len)));
        score += tf * idf * 2.0;
      }

      // TF in snippet — O(1) map lookup
      const snippetCount = rt.snippetCountMap.get(term) ?? 0;
      if (snippetCount > 0) {
        const tf = snippetCount / (snippetCount + k1 * (1 - b + b * (snippetTokens.length / len)));
        score += tf * idf;
      }
    }

    resultScores[i] = score;
  }

  // Sort by score descending (stable)
  const indexed = results.map((r, i) => ({ result: r, score: resultScores[i]! }));
  indexed.sort((a, b) => b.score - a.score);

  return indexed.map(x => x.result);
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
    // Single Map tracks count per domain; inclusion tracked by index scan
    const domainCount = new Map<string, number>();
    for (const r of capped) {
      const domain = r.domain || '__no_domain__';
      domainCount.set(domain, (domainCount.get(domain) || 0) + 1);
    }
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      // Check inclusion by index (avoids Set allocation)
      let included = false;
      for (let j = 0; j < capped.length; j++) {
        if (capped[j] === r) { included = true; break; }
      }
      if (included) continue;
      const domain = r.domain || '__no_domain__';
      const count = domainCount.get(domain) || 0;
      if (count < maxPerDomain * 3) { // Allow up to 3x per domain when relaxing
        capped.push(r);
        domainCount.set(domain, count + 1);
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
    if (r.source) line += `  [${r.source}]`;
    line += `\n   URL: ${r.url}`;
    if (r.snippet) line += `\n   ${r.snippet.substring(0, 200)}`;
    if (r.domain) line += `\n   Domain: ${r.domain}`;
    if (r.score !== undefined || r.viewCount !== undefined) {
      let stats = '';
      if (r.score !== undefined) stats += `Score: +${r.score}`;
      if (r.viewCount !== undefined) stats += `${stats ? ' · ' : ''}${r.viewCount} views`;
      line += `\n   ${stats}`;
    }
    return line;
  }).join('\n\n');
}