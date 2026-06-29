#!/usr/bin/env node
// Fetch a web page and return readable text content
// Extraction pipeline: Defuddle → Jina Reader fallback
// Caching in ~/.pi/tools-cache/

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Defuddle } from 'defuddle/node';
import { loadConfig } from './config.js';

// ─── Configuration ───────────────────────────────────────────────────────────
const config = loadConfig();
const fetchConfig = config['web-fetch'] || {};
const jinaEnabled = fetchConfig.jinaEnabled !== false; // default true
const MIN_DELAY = fetchConfig['min-delay'] ?? 1000;
const MAX_DELAY = fetchConfig['max-delay'] ?? 3000;
const CACHE_MAX_FILES = fetchConfig['cache-max-files'] ?? 100;
const CACHE_DIR = `${process.env.HOME || process.env.USERPROFILE}/.pi/tools-cache/web_fetch`;
const CACHE_TTL = 3600; // 1 hour in seconds
const HEADING_THRESHOLD = fetchConfig['heading-threshold'] ?? 40000;

// ─── User-Agent pool ─────────────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.141 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5.1 Mobile/15E148 Safari/604.1',
];

const ACCEPT_LANGUAGES = ['en-US,en;q=0.9', 'en-GB,en;q=0.9', 'en-US,en;q=0.8,de;q=0.5'];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// ─── Cache helpers ───────────────────────────────────────────────────────────
function normalizeUrl(u) {
  return u.toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/www\./, 'https://');
}

function urlToKey(u) {
  return createHash('sha256').update(normalizeUrl(u)).digest('hex');
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function listCacheFiles() {
  ensureCacheDir();
  return fs.readdirSync(CACHE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: `${CACHE_DIR}/${f}`,
      mtime: fs.statSync(`${CACHE_DIR}/${f}`).mtimeMs,
    }))
    .sort((a, b) => a.mtime - b.mtime);
}

function evictIfNecessary() {
  const files = listCacheFiles();
  while (files.length >= CACHE_MAX_FILES) {
    const oldest = files.shift();
    fs.unlinkSync(oldest.path);
  }
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
  evictIfNecessary();
  fs.writeFileSync(`${CACHE_DIR}/${key}.json`, JSON.stringify(data), 'utf8');
}

// ─── Cloudflare/WAF detection ────────────────────────────────────────────────
function isCloudflareChallenge(body) {
  const patterns = [
    /checking your browser/i,
    /DDoS protection by Cloudflare/i,
    /__cf_chl_/i,
    /Please wait while we/i,
    /Ray ID:|cf-ray/i,
  ];
  return patterns.some(p => p.test(body));
}

function isProtectedOrJsHeavy(html) {
  const body = html.toLowerCase();

  // 1. Bot protection markers
  const botSignals = [
    /cloudflare.*challeng/i,
    /__cf_chl__/,
    /js_challenge/, // Cloudflare JS challenge
    /captcha|verify_you_are_human/i,
    /perimeterx|dx\.co/i, // PerimeterX
    /datadome\.co|datadome\.com/i,
    /hcaptcha\.com|recaptcha\.net|google\.com\/recaptcha/i,
    /imperva|incapsula/i,
    /bancal\.ai|arkoselabs/i, // Arkose Labs
    /verify.*first/i, // Generic "verify first" challenges
    /session.*expired.*verify/i,
    /protected.*by.*bot/i,
    /enable.*javascript.*browser/i, // "Enable JavaScript" message
    /your browser must enable javascript/i,
    /please enable javascript/i,
    /security check/i,
  ];
  if (botSignals.some(p => p.test(body))) return true;

  // 2. SPA/JS-rendered patterns — page is mostly empty without JS
  const bodyContent = body.replace(/<body[^>]*>([\s\S]*?)<\/body>/i, '$1');
  const textOnly = bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Very little text content but lots of scripts
  // Raised thresholds to avoid false positives on sites like Hacker News
  const scriptCount = (body.match(/<script[^>]*>/gi) || []).length;
  const hasFewTextButManyScripts = textOnly.length < 50 && scriptCount > 5;
  if (hasFewTextButManyScripts) return true;

  // 3. SPA frameworks / JS-rendered indicators — only the SSR-fallback patterns
  // A real SPA has minimal/no text in the HTML and a noscript + app div combo
  // We skip framework markers alone (ng-app, id=app, etc.) since static sites use those too
  const spaIndicators = [
    /<\/noscript>\s*<div\s+id="__nuxt"/i, // Nuxt SSR fallback
    /<\/noscript>\s*<div\s+id="__vue__"/i, // Vue SSR fallback
    /<\/noscript>\s*<div\s+id="app"/i, // Generic SSR fallback
    /window\.__NUXT__\s*=\s*\{/i, // Nuxt runtime data
    /window\.__PRELOADED_STATE__|window\.__NEXT_DATA__|window\.__REDUX_STATE__/i,
  ];
  if (spaIndicators.some(p => p.test(body))) return true;

  // 4. "This site requires JavaScript" messages
  const jsRequiredPatterns = [
    /this site requires javascript/i,
    /please enable javascript/i,
    /your browser does not support javascript/i,
  ];
  if (jsRequiredPatterns.some(p => p.test(body))) return true;

  return false;
}

// ─── Defuddle extraction (local, instant) ────────────────────────────────────
async function extractWithDefuddle(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const result = await Defuddle(dom.window.document, url, { markdown: true });
  const bodyText = result.content?.trim() || '';
  const title = result.title?.trim() || '';
  const author = result.author?.trim() || '';
  const description = result.description?.trim() || '';
  const date = result.date?.trim() || '';
  const lang = result.lang || '';
  return { bodyText, title, author, description, date, lang };
}

// ─── Jina Reader fallback (cloud) ───────────────────────────────────────────
async function fetchWithJina(url, timeoutMs) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), Math.min(timeoutMs, 30000));

  const res = await fetch(`https://r.jina.ai/${url}`, {
    signal: controller.signal,
    headers: {
      'User-Agent': pickRandom(USER_AGENTS),
      'Accept': 'text/plain',
      'X-Return-Format': 'text',
    },
  });

  if (!res.ok) {
    throw new Error(`Jina Reader HTTP ${res.status}`);
  }

  const text = await res.text();
  let title = '';
  let bodyText = text;

  const titleMatch = text.match(/^Title: ([^\n]+)/m);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  const dashIdx = text.indexOf('\n---\n');
  if (dashIdx > 0) {
    bodyText = text.slice(dashIdx + 6);
  }

  return { title, bodyText };
}

// ─── GitHub detection ────────────────────────────────────────────────────────
const GITHUB_URL_RE = /^https?:\/\/(?:www\.)?github\.com\//;

function isGitHubUrl(url) {
  return GITHUB_URL_RE.test(url);
}

async function fetchGitHubContent(html, url) {
  // Try to parse GitHub file view URL: /owner/repo/blob/ref/path/to/file
  const fileMatch = url.match(/\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (fileMatch) {
    const [, owner, repo, ref, filePath] = fileMatch;

    // Fetch raw content from GitHub
    const apiRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`, {
      headers: { 'User-Agent': pickRandom(USER_AGENTS) },
    });

    if (apiRes.ok) {
      const content = await apiRes.text();
      return {
        title: `${owner}/${repo} — ${filePath}`,
        bodyText: content,
        source: 'github',
      };
    }
  }

  return null;
}

// ─── Smart truncation (heading-based summary) ────────────────────────────────
function smartTruncate(content, title) {
  const lines = content.split('\n');
  const headings = [];
  let result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (headings.length > 0 && result.length > 0) {
        const currentLength = result.join('\n').length;
        if (currentLength >= HEADING_THRESHOLD) {
          return {
            title,
            bodyText: result.join('\n') +
              `\n\n---\n[... content truncated (${content.length} total chars, showing first ${HEADING_THRESHOLD})]\n\nRemaining headings:\n` +
              headings.slice(0, 10).map(([level, text]) => `${'#'.repeat(level)} ${text}`).join('\n') +
              (headings.length > 10 ? `\n... and ${headings.length - 10} more headings` : ''),
            truncated: true,
          };
        }
      }
      headings.push([headingMatch[1].length, headingMatch[2].trim()]);
    }
    result.push(line);
  }

  return { title, bodyText: result.join('\n'), truncated: false };
}

// ─── Failure detection for Defuddle ──────────────────────────────────────────
function isDefuddleFailure(result) {
  const contentEmpty = !result.bodyText || result.bodyText.trim().length < 150;
  const titleBad = !result.title ||
    result.title === 'Untitled' ||
    result.title === 'Untitled Document' ||
    /^https?:\/\/[^/]+/i.test(result.title || '');
  return contentEmpty || titleBad;
}

// ─── Fetch with retry ────────────────────────────────────────────────────────
const RETRY_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

async function fetchWithRetry(targetUrl, timeoutMs) {
  let url = targetUrl;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  for (let i = 0; i <= MAX_RETRIES; i++) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': pickRandom(USER_AGENTS),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': pickRandom(ACCEPT_LANGUAGES),
          'Accept-Encoding': 'gzip, deflate, br',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'follow',
      });

      if (res.ok) return { res, url: res.url };

      if (!RETRY_CODES.has(res.status)) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const retryAfter = res.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, i) * 1000 + Math.random() * 500;

      if (i < MAX_RETRIES) {
        await delay(waitMs);
      }
    } catch (err) {
      if (i < MAX_RETRIES && (err.name === 'AbortError' || err.code)) {
        await delay(Math.pow(2, i) * 1000 + Math.random() * 500);
      } else {
        throw new Error(err.message || String(err));
      }
    }
  }
  throw new Error(`Failed after ${MAX_RETRIES} retries`);
}

// ─── Argument parsing ────────────────────────────────────────────────────────
const _rawArgs = process.argv.slice(2);
let url = '';
const flags = [];
let timeoutMs = 15000;
let raw = false;
let quiet = false;
let noCache = false;
let short = false;
let format = 'text'; // 'text' (default), 'markdown', 'raw', 'json'

for (let i = 0; i < _rawArgs.length; i++) {
  if (_rawArgs[i] === 'url') {
    url = _rawArgs[++i] || '';
  } else if (_rawArgs[i] === '--timeout') {
    const val = _rawArgs[++i];
    if (val) {
      timeoutMs = parseInt(val, 10);
      if (isNaN(timeoutMs) || timeoutMs <= 0) {
        console.error('Error: --timeout requires a positive integer in milliseconds');
        process.exit(1);
      }
    }
  } else if (_rawArgs[i] === '--short') {
    short = true;
  } else if (_rawArgs[i] === '--raw') {
    raw = true;
  } else if (_rawArgs[i] === '--quiet') {
    quiet = true;
  } else if (_rawArgs[i] === '--no-cache') {
    noCache = true;
  } else if (_rawArgs[i] === '--format') {
    format = _rawArgs[++i] || 'text';
    if (!['text', 'markdown', 'raw', 'json'].includes(format)) {
      console.error('Error: --format must be one of: text, markdown, raw, json');
      process.exit(1);
    }
  } else if (_rawArgs[i].startsWith('--')) {
    // Unknown flag, skip it
  } else {
    if (!url) url = _rawArgs[i];
  }
}

if (!url) {
  console.error('Usage: web_fetch <URL> [--raw] [--quiet] [--short] [--no-cache] [--format text|markdown|raw|json] [--timeout <ms>]');
  console.error('  --raw          Return raw HTML instead of extracted text');
  console.error('  --quiet        Suppress metadata, output only content');
  console.error('  --short        Truncate output to 4000 chars (default: 50000)');
  console.error('  --no-cache     Bypass local cache');
  console.error('  --format FMT   Output format: text, markdown, raw, json (default: text)');
  console.error('  --timeout ms   Request timeout in milliseconds (default: 15000)');
  process.exit(1);
}

const maxLen = short ? 4000 : 50000;

// ─── Main fetch logic ────────────────────────────────────────────────────────
async function fetchPage(targetUrl) {
  const cacheKey = urlToKey(targetUrl);

  // Check cache first
  if (!noCache) {
    const cached = getCached(cacheKey);
    if (cached) {
      if (!quiet) {
        if (format === 'markdown' || format === 'text') {
          console.log(`URL: ${cached.url || targetUrl}`);
          if (cached.title) console.log(`Title: ${cached.title}`);
          if (cached.source) console.log(`Source: ${cached.source}`);
          console.log('---');
          console.log(`[Cached — ${new Date(cached.timestamp).toISOString()}]`);
          console.log(cached.bodyText.slice(0, maxLen));
          if (cached.bodyText.length > maxLen) {
            console.log(`\n\n[... truncated (total: ${cached.bodyText.length} chars)]`);
          }
        } else {
          console.log(JSON.stringify({
            url: cached.url || targetUrl,
            title: cached.title,
            source: cached.source,
            cached: new Date(cached.timestamp).toISOString(),
            content: cached.bodyText.slice(0, maxLen),
          }, null, 2));
        }
      }
      return;
    }
  }

  // Delay for politeness
  await delay(MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));

  // Fetch with retry
  const { res, url: resolvedUrl } = await fetchWithRetry(targetUrl, timeoutMs);
  const text = await res.text();

  // Cloudflare warning
  if (isCloudflareChallenge(text)) {
    console.error('Warning: Site is behind Cloudflare protection.');
    console.error('Content extraction may be incomplete. Use --raw for full HTML.');
  }

  if (raw) {
    if (format === 'markdown' || format === 'text') {
      console.log(`URL: ${resolvedUrl}`);
      console.log('---');
      process.stdout.write(text.slice(0, maxLen));
    } else {
      console.log(JSON.stringify({ url: resolvedUrl, content: text.slice(0, maxLen) }, null, 2));
    }
    if (!noCache) {
      putCache(cacheKey, { url: resolvedUrl, title: '', bodyText: text, timestamp: Date.now(), contentLength: text.length });
    }
    return;
  }

  // ─── Content-type aware handling ───────────────────────────────────────
  const contentType = res.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    const jsonStr = JSON.stringify(JSON.parse(text), null, 2).slice(0, maxLen);
    if (format === 'markdown' || format === 'text') {
      console.log(`URL: ${resolvedUrl}`);
      console.log('Format: JSON');
      console.log('---');
      console.log(jsonStr);
    } else {
      console.log(JSON.stringify({ url: resolvedUrl, content: jsonStr, format: 'json' }, null, 2));
    }
    if (!noCache) {
      putCache(cacheKey, { url: resolvedUrl, title: '', bodyText: jsonStr, timestamp: Date.now() });
    }
    return;
  }

  if (contentType.includes('text/plain')) {
    if (format === 'markdown' || format === 'text') {
      console.log(`URL: ${resolvedUrl}`);
      console.log('Format: Plain text');
      console.log('---');
      console.log(text.slice(0, maxLen));
    } else {
      console.log(JSON.stringify({ url: resolvedUrl, content: text.slice(0, maxLen), format: 'text' }, null, 2));
    }
    if (!noCache) {
      putCache(cacheKey, { url: resolvedUrl, title: '', bodyText: text, timestamp: Date.now() });
    }
    return;
  }

  // ─── HTML extraction pipeline ──────────────────────────────────────────
  let result = null;

  // Step 1: Check for GitHub URLs
  if (isGitHubUrl(resolvedUrl)) {
    result = await fetchGitHubContent(text, resolvedUrl);
  }

  // Step 2: Proactively detect protected/JS-heavy pages → skip Defuddle, go straight to Jina
  if (!result && !isProtectedOrJsHeavy(text)) {
    // Safe to try Defuddle
    try {
      result = await extractWithDefuddle(text, resolvedUrl);
      result.source = 'defuddle';
    } catch (err) {
      console.error(`Defuddle error: ${err.message}`);
    }

    // If Defuddle still produced poor results, try Jina
    if (!result || isDefuddleFailure(result)) {
      if (!jinaEnabled) {
        console.error('Warning: Defuddle failed and jinaEnabled is false.');
        console.error('Returning raw HTML (use --raw to suppress this message).');
        if (format === 'markdown' || format === 'text') {
          console.log(`URL: ${resolvedUrl}`);
          console.log('---');
          process.stdout.write(text.slice(0, maxLen));
        } else {
          console.log(JSON.stringify({ url: resolvedUrl, content: text.slice(0, maxLen), warning: 'Defuddle failed, jinaEnabled=false' }, null, 2));
        }
        return;
      }
      console.error('[Defuddle returned low-quality content, trying Jina Reader...]');
      try {
        result = await fetchWithJina(resolvedUrl, timeoutMs);
        result.source = 'jina';
      } catch (err) {
        console.error(`Jina Reader error: ${err.message}`);
        result = {
          title: '',
          bodyText: text,
          source: 'raw',
          warning: `Fallback to raw HTML: ${err.message}`,
        };
      }
    }
  } else if (!result && isProtectedOrJsHeavy(text)) {
    // Detected bot protection or JS-rendered — skip Defuddle, go straight to Jina
    console.error('[Detected bot protection / JS-heavy page, using Jina Reader directly...]');
    if (!jinaEnabled) {
      console.error('Warning: Detected protected page and jinaEnabled is false.');
      console.error('Returning raw HTML (use --raw to suppress this message).');
      if (format === 'markdown' || format === 'text') {
        console.log(`URL: ${resolvedUrl}`);
        console.log('---');
        process.stdout.write(text.slice(0, maxLen));
      } else {
        console.log(JSON.stringify({ url: resolvedUrl, content: text.slice(0, maxLen), warning: 'Protected page detected, jinaEnabled=false' }, null, 2));
      }
      return;
    }
    try {
      result = await fetchWithJina(resolvedUrl, timeoutMs);
      result.source = 'jina';
    } catch (err) {
      console.error(`Jina Reader error: ${err.message}`);
      result = {
        title: '',
        bodyText: text,
        source: 'raw',
        warning: `Fallback to raw HTML: ${err.message}`,
      };
    }
  }

  // Step 4: Smart truncation for large content
  const truncatedResult = smartTruncate(result.bodyText, result.title || '');

  // Step 5: Format and output
  const output = {
    url: resolvedUrl,
    title: truncatedResult.title || '',
    content: truncatedResult.bodyText.slice(0, maxLen),
    source: result.source || 'defuddle',
    truncated: truncatedResult.truncated || false,
  };

  if (quiet) {
    if (format === 'markdown' || format === 'text') {
      console.log(output.content);
    } else {
      console.log(JSON.stringify({ content: output.content }, null, 2));
    }
  } else if (format === 'markdown' || format === 'text') {
    console.log(`URL: ${output.url}`);
    if (output.title) console.log(`Title: ${output.title}`);
    if (output.source && output.source !== 'defuddle') console.log(`Source: ${output.source}`);
    if (output.truncated) console.log('---');
    if (output.truncated) console.log('[... content truncated, see summary below ...]');
    if (result.warning) console.log(`[Warning: ${result.warning}]`);
    console.log('---');
    console.log(output.content);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }

  // Cache
  if (!noCache) {
    putCache(cacheKey, {
      url: resolvedUrl,
      title: truncatedResult.title || '',
      bodyText: truncatedResult.bodyText,
      timestamp: Date.now(),
      contentLength: text.length,
      source: result.source,
      truncated: truncatedResult.truncated,
    });
  }
}

fetchPage(url)
  .then(() => process.exit(0))
  .catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });