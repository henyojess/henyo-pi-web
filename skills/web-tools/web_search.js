#!/usr/bin/env node
// Search the web using a configurable provider chain
// Context-driven: coding (DDG, SO, npm, GitHub) vs general (DDG, Wikipedia, Jina)

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { loadConfig } from './config.js';

// ─── Configuration ───────────────────────────────────────────────────────────
const config = loadConfig();
const searchConfig = config['web-search'] || {};
const contexts = searchConfig.contexts || {};
const CACHE_DIR = `${process.env.HOME || process.env.USERPROFILE}/.pi/tools-cache/web_search`;
const CACHE_TTL = 1800; // 30 minutes

// ─── User-Agent pool ─────────────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.141 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
];

const ACCEPT_LANGUAGES = ['en-US,en;q=0.9', 'en-GB,en;q=0.9'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// ─── Cache helpers ───────────────────────────────────────────────────────────
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function urlToKey(u) {
  return createHash('sha256').update(u).digest('hex');
}

function getCached(key) {
  const cachePath = `${CACHE_DIR}/${key}.json`;
  if (!fs.existsSync(cachePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const age = (Date.now() - data.timestamp) / 1000;
    if (age > CACHE_TTL) {
      fs.unlinkSync(cachePath);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function putCache(key, data) {
  ensureCacheDir();
  fs.writeFileSync(`${CACHE_DIR}/${key}.json`, JSON.stringify(data), 'utf8');
}

// ─── Context selection ───────────────────────────────────────────────────────
const CODING_SIGNALS = [
  /Error:/,
  /TypeError/,
  /SyntaxError/,
  /Traceback/,
  /cannot find module/,
  /import\s+/,
  /const\s+/,
  /async\s+/,
  /await\s+/,
  /def\s+/,
  /class\s+/,
  /npm\s/,
  /pip\s/,
  /cargo\s/,
  /yarn\s/,
  /brew\s/,
  /Dockerfile/,
  /Makefile/,
  /git\s/,
  /chmod\s/,
  /chown\s/,
];

function detectContext(query) {
  let codingSignals = 0;
  for (const signal of CODING_SIGNALS) {
    if (signal.test(query)) codingSignals++;
  }
  return codingSignals >= 2 ? 'coding' : 'general';
}

// ─── Provider implementations ────────────────────────────────────────────────

async function searchDuckDuckGo(query) {
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

  let html = null;
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

  const results = [];
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
        snippet: snippet,
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

async function searchStackOverflow(query) {
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

  const results = [];
  const questions = html.match(/<div class="s-prose js-post-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g);
  if (!questions) return [];

  const itemRegex = /<a[^>]*class="s-link[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

  for (const question of questions.slice(0, 10)) {
    const titleMatch = question.match(/class="s-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (titleMatch) {
      let url = titleMatch[1];
      if (url.startsWith('/')) url = 'https://stackoverflow.com' + url;
      let title = titleMatch[2].replace(/<[^>]+>/g, ' ').trim();
      if (!title) continue;

      // Get snippet from the question body
      const snippetMatch = question.match(/<p[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/p>/);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200) : '';

      results.push({
        title: title.substring(0, 200),
        url: url.split('?')[0],
        snippet: snippet,
        source: 'stackoverflow',
      });
    }
  }

  return results;
}

async function searchNpm(query) {
  await delay(1000 + Math.random() * 1500);

  try {
    const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=10`, {
      headers: { 'User-Agent': pickRandom(USER_AGENTS) },
    });

    if (!res.ok) return [];
    const data = await res.json();

    return (data.objects || []).map(obj => {
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

async function searchGitHub(query) {
  await delay(1500 + Math.random() * 2000);

  try {
    const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`, {
      headers: { 'User-Agent': pickRandom(USER_AGENTS) },
    });

    if (!res.ok) return [];
    const data = await res.json();

    return (data.items || []).map(item => ({
      title: `${item.owner.login}/${item.name} (${item.language || 'unknown'})`,
      url: item.html_url,
      snippet: item.description || 'No description',
      source: 'github',
    }));
  } catch {
    return [];
  }
}

async function searchWikipedia(query) {
  await delay(1000 + Math.random() * 1500);

  try {
    // Search first
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=10&format=json`,
      { headers: { 'User-Agent': pickRandom(USER_AGENTS) } }
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const [titles, urls, descriptions] = searchData.slice(1);

    if (!titles) return [];

    // Get excerpts for each result
    const results = [];
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

async function searchJina(query) {
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
      body: JSON.stringify({
        search: query,
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();

    // Jina Search returns a structured response
    return (data.results || []).map(r => ({
      title: r.title || 'Untitled',
      url: r.url || '',
      snippet: (r.content || '').replace(/<[^>]+>/g, ' ').trim().substring(0, 300),
      source: 'jina-search',
    }));
  } catch {
    return [];
  }
}

async function searchSearXNG(settings, query) {
  const searxng = settings.searxng || {};
  const url = searxng.url;

  if (!url) {
    console.error('Warning: SearXNG URL not configured in settings.');
    return [];
  }

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

    return (data.results || []).slice(0, 10).map(r => ({
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
const PROVIDER_MAP = {
  duckduckgo: searchDuckDuckGo,
  stackoverflow: searchStackOverflow,
  npm: searchNpm,
  github: searchGitHub,
  wikipedia: searchWikipedia,
  jina: searchJina,
  searxng: searchSearXNG,
};

// ─── Build provider chain from config ────────────────────────────────────────
function buildProviderChain(contextName) {
  const context = contexts[contextName] || {};
  const providers = [];

  // Check for SearXNG override (priority 0 = replace default chain)
  if (context.searxng && context.searxng.priority === 0) {
    return [{ name: 'searxng', priority: 0, config: context, fn: PROVIDER_MAP.searxng }];
  }

  for (const [name, cfg] of Object.entries(context)) {
    if (cfg.priority !== undefined && PROVIDER_MAP[name]) {
      providers.push({ name, priority: cfg.priority, config: context, fn: PROVIDER_MAP[name] });
    }
  }

  // Sort by priority (lower = higher priority, run first)
  providers.sort((a, b) => a.priority - b.priority);
  return providers;
}

// ─── Merge and deduplicate results ───────────────────────────────────────────
function mergeResults(allResults) {
  const seen = new Set();
  const merged = [];

  for (const results of allResults) {
    for (const r of results) {
      const url = r.url.replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, 'https://');
      if (!seen.has(url)) {
        seen.add(url);
        merged.push(r);
      }
    }
  }

  return merged;
}

// ─── Argument parsing ────────────────────────────────────────────────────────
const _rawArgs = process.argv.slice(2);
let query = '';
const flags = [];
let maxResults = 10;
let jsonOutput = true; // Default to JSON
let noCache = false;
let forceContext = null;

for (let i = 0; i < _rawArgs.length; i++) {
  if (_rawArgs[i] === 'query') {
    query = _rawArgs[++i] || '';
  } else if (_rawArgs[i] === '--max') {
    maxResults = parseInt(_rawArgs[++i] || '10', 10) || 10;
  } else if (_rawArgs[i] === '--text') {
    jsonOutput = false;
  } else if (_rawArgs[i] === '--no-cache') {
    noCache = true;
  } else if (_rawArgs[i] === '--context') {
    forceContext = _rawArgs[++i] || null;
  } else if (_rawArgs[i].startsWith('--')) {
    // Unknown flag, skip
  } else {
    if (!query) query = _rawArgs[i];
  }
}

if (!query) {
  console.error('Usage: web_search <query> [--max N] [--text] [--no-cache] [--context coding|general]');
  console.error('  --max N        Max results to return (default: 10)');
  console.error('  --text         Output as formatted text instead of JSON');
  console.error('  --no-cache     Skip cache');
  console.error('  --context CTX  Force context: coding, general, or custom (default: auto-detect)');
  process.exit(1);
}

// ─── Main search logic ───────────────────────────────────────────────────────
async function search() {
  // Determine context
  const contextName = forceContext || detectContext(query);

  // Build provider chain
  const providers = buildProviderChain(contextName);
  if (providers.length === 0) {
    console.error('Error: No providers configured for context:', contextName);
    process.exit(1);
  }

  // Check cache
  const cacheKey = `search:${contextName}:${query}`;
  if (!noCache) {
    const cached = getCached(cacheKey);
    if (cached) {
      if (cached.length === 0) {
        console.error('[cache hit]');
        if (jsonOutput) {
          console.log(JSON.stringify([], null, 2));
        } else {
          console.log('No results found.');
        }
        return;
      }
      if (jsonOutput) {
        console.log(JSON.stringify(cached, null, 2));
      } else {
        console.error(`[cache hit — ${cached.length} results]`);
        cached.forEach((r, i) => {
          console.log(`${i + 1}. ${r.title}`);
          console.log(`   URL: ${r.url}`);
          if (r.snippet) console.log(`   ${r.snippet.substring(0, 150)}`);
          console.log();
        });
      }
      return;
    }
  }

  // Run providers sequentially, grouped by priority
  const priorities = [...new Set(providers.map(p => p.priority))].sort((a, b) => a - b);
  const allResults = [];

  for (const priority of priorities) {
    const priorityProviders = providers.filter(p => p.priority === priority);
    const groupResults = [];

    for (const provider of priorityProviders) {
      try {
        console.error(`  [${provider.name}] Searching...`);
        const results = await provider.fn(query);
        console.error(`  [${provider.name}] Found ${results.length} results`);
        groupResults.push(...results);
      } catch (err) {
        console.error(`  [${provider.name}] Error: ${err.message}`);
      }
    }

    // Deduplicate within the group
    const seenInGroup = new Set();
    for (const r of groupResults) {
      const url = r.url.replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, 'https://');
      if (!seenInGroup.has(url)) {
        seenInGroup.add(url);
        allResults.push(r);
      }
    }

    // If we have enough results, stop
    if (allResults.length >= maxResults) break;
  }

  // Limit to max results
  const results = allResults.slice(0, maxResults);

  // Cache results
  if (!noCache) {
    putCache(cacheKey, results);
  }

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    if (results.length === 0) {
      console.log('No results found.');
      return;
    }
    results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.title}`);
      console.log(`   URL: ${r.url}`);
      if (r.snippet) console.log(`   ${r.snippet.substring(0, 200)}`);
      if (r.source) console.log(`   Source: ${r.source}`);
      console.log();
    });
  }
}

search()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });