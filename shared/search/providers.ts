import { pickRandom, delay, USER_AGENTS, ACCEPT_LANGUAGES } from '../user-agents';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

// ─── DuckDuckGo ──────────────────────────────────────────────────────────────

export async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const endpoints = [
    'https://html.duckduckgo.com/html/?q=',
    'https://duckduckgo.com/html/?q=',
  ];

  await delay(2000 + Math.random() * 3000);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 15000);

  const opts = {
    signal: controller.signal,
    headers: {
      'User-Agent': pickRandom(USER_AGENTS),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': pickRandom(ACCEPT_LANGUAGES),
      'Referer': 'https://duckduckgo.com/',
    },
  };

  let html: string | null = null;
  for (const base of endpoints) {
    const url = `${base}${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, opts);
      if (!res.ok) continue;
      html = await res.text();
      if (html.toLowerCase().includes('captcha') || html.toLowerCase().includes('access denied')) {
        html = null;
        continue;
      }
      break;
    } catch {
      continue;
    }
  }

  if (!html) return [];

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) return [];
  const body = bodyMatch[1];

  if (body.includes('No results')) return [];

  const results: SearchResult[] = [];
  const resultDivRegex = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let divMatch;

  while ((divMatch = resultDivRegex.exec(body)) !== null) {
    const divContent = divMatch[1];
    const titleMatch = divContent.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? titleMatch[2].replace(/<[^>]+>/g, '').trim() : '';
    let redirectUrl = titleMatch ? titleMatch[1].trim() : '';

    let actualUrl = '';
    if (redirectUrl) {
      const rParam = new URLSearchParams(redirectUrl.includes('?') ? redirectUrl.split('?')[1] : '');
      actualUrl = rParam.get('uddg') || '';
      if (!actualUrl) {
        const pathMatch = redirectUrl.match(/\/l\/\?([^"]+)/);
        if (pathMatch) {
          actualUrl = decodeURIComponent(pathMatch[1].split('uddg=')[1]?.split('&')[0] || '');
        }
      }
    }
    if (!actualUrl) {
      const urlMatch = divContent.match(/class="result__url"[^>]*>([^<]+)<\/a>/i);
      actualUrl = urlMatch ? urlMatch[1].trim() : '';
    }

    const snippetMatch = divContent.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    if (title || actualUrl) {
      results.push({
        title: title || 'Untitled',
        url: actualUrl || redirectUrl || '',
        snippet,
      });
    }
  }

  // "Did you mean" / instant answers
  const abstractMatch = body.match(/class="abstract"[^>]*>([\s\S]*?)<\/a>/i);
  if (abstractMatch) {
    const text = abstractMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) {
      results.unshift({
        title: 'Direct Answer',
        url: '—',
        snippet: text,
      });
    }
  }

  return results;
}

// ─── StackOverflow ───────────────────────────────────────────────────────────

export async function searchStackOverflow(query: string): Promise<SearchResult[]> {
  await delay(1500 + Math.random() * 2000);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 15000);

  const url = `https://stackoverflow.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': pickRandom(USER_AGENTS),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!res.ok) return [];
  const html = await res.text();

  const results: SearchResult[] = [];
  const questions = html.match(/<div class="s-prose js-post-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g);
  if (!questions) return [];

  for (const question of questions.slice(0, 10)) {
    const titleMatch = question.match(/class="s-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (titleMatch) {
      let url = titleMatch[1];
      if (url.startsWith('/')) url = 'https://stackoverflow.com' + url;
      let title = titleMatch[2].replace(/<[^>]+>/g, ' ').trim();
      if (!title) continue;

      const snippetMatch = question.match(/<p[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/p>/);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200) : '';

      results.push({
        title: title.substring(0, 200),
        url: url.split('?')[0],
        snippet,
        source: 'stackoverflow',
      });
    }
  }

  return results;
}

// ─── npm ─────────────────────────────────────────────────────────────────────

export async function searchNpm(query: string): Promise<SearchResult[]> {
  await delay(1000 + Math.random() * 1500);

  try {
    const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=10`, {
      headers: { 'User-Agent': pickRandom(USER_AGENTS) },
    });

    if (!res.ok) return [];
    const data = await res.json();

    return (data.objects || []).map((obj: any) => {
      const pkg = obj.package;
      return {
        title: `${pkg.name}@${pkg.version}`,
        url: `https://www.npmjs.com/package/${pkg.name}`,
        snippet: pkg.description || '',
        source: 'npm',
      };
    });
  } catch {
    return [];
  }
}

// ─── GitHub ──────────────────────────────────────────────────────────────────

export async function searchGitHub(query: string): Promise<SearchResult[]> {
  await delay(1500 + Math.random() * 2000);

  try {
    const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`, {
      headers: { 'User-Agent': pickRandom(USER_AGENTS) },
    });

    if (!res.ok) return [];
    const data = await res.json();

    return (data.items || []).map((item: any) => ({
      title: `${item.owner.login}/${item.name} (${item.language || 'unknown'})`,
      url: item.html_url,
      snippet: item.description || 'No description',
      source: 'github',
    }));
  } catch {
    return [];
  }
}

// ─── Wikipedia ───────────────────────────────────────────────────────────────

export async function searchWikipedia(query: string): Promise<SearchResult[]> {
  await delay(1000 + Math.random() * 1500);

  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=10&format=json`,
      { headers: { 'User-Agent': pickRandom(USER_AGENTS) } }
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const [titles, urls, descriptions] = searchData.slice(1);

    if (!titles) return [];

    const results: SearchResult[] = [];
    for (let i = 0; i < titles.length; i++) {
      const excerptRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles[i])}&prop=extracts&exintro=true&explaintext=true&format=json`,
        { headers: { 'User-Agent': pickRandom(USER_AGENTS) } }
      );
      if (!excerptRes.ok) continue;
      const exData = await excerptRes.json();
      const pages = exData.query.pages;
      const pageId = Object.keys(pages)[0];
      const extract = pages[pageId]?.extract || '';

      results.push({
        title: titles[i],
        url: urls[i],
        snippet: extract ? extract.substring(0, 300) + (extract.length > 300 ? '...' : '') : descriptions[i] || '',
        source: 'wikipedia',
      });
    }

    return results;
  } catch {
    return [];
  }
}

// ─── Jina Search ─────────────────────────────────────────────────────────────

export async function searchJina(query: string): Promise<SearchResult[]> {
  await delay(1000 + Math.random() * 1500);

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20000);

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

    if (!res.ok) return [];
    const data = await res.json();

    return (data.results || []).map((r: any) => ({
      title: r.title || 'Untitled',
      url: r.url || '',
      snippet: (r.content || '').replace(/<[^>]+>/g, ' ').trim().substring(0, 300),
      source: 'jina-search',
    }));
  } catch {
    return [];
  }
}

// ─── SearXNG ─────────────────────────────────────────────────────────────────

export async function searchSearXNG(url: string, query: string): Promise<SearchResult[]> {
  if (!url) return [];

  await delay(1000 + Math.random() * 1500);

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${url}/search?q=${encodeURIComponent(query)}&format=json`, {
      signal: controller.signal,
      headers: { 'User-Agent': pickRandom(USER_AGENTS) },
    });

    if (!res.ok) return [];
    const data = await res.json();

    return (data.results || []).slice(0, 10).map((r: any) => ({
      title: r.title || 'Untitled',
      url: r.url || '',
      snippet: (r.content || '').substring(0, 300),
      source: 'searxng',
    }));
  } catch {
    return [];
  }
}

// ─── Provider map ────────────────────────────────────────────────────────────

export const PROVIDER_MAP: Record<string, (...args: any[]) => Promise<SearchResult[]>> = {
  duckduckgo: searchDuckDuckGo,
  stackoverflow: searchStackOverflow,
  npm: searchNpm,
  github: searchGitHub,
  wikipedia: searchWikipedia,
  jina: searchJina,
  searxng: searchSearXNG,
};