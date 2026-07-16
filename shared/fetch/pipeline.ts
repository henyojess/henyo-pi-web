import { createCache, keyToPath } from '../cache';
import type { WebFetchConfig } from '../config';
import { pickRandom, delay, USER_AGENTS, ACCEPT_LANGUAGES } from '../user-agents';
import { extractWithDefuddle, fetchWithJina } from './extract';
import { isCloudflareChallenge, isProtectedOrJsHeavy, isDefuddleFailure } from './detection';
import { isGitHubUrl, fetchGitHubContent } from './github';
import { smartTruncate } from './truncate';
import { fetchWithRetry } from './retry';
import { normalizeUrl } from '../format';

export interface FetchOptions {
  url: string;
  timeout: number;
  noCache: boolean;
  config: WebFetchConfig;
  signal?: AbortSignal;
  onUpdate?: (update: { content: Array<{ type: string; text: string }> }) => void;
}

export interface FetchResult {
  text: string;
  resolvedUrl: string;
  title: string;
  source: string;
  truncated: boolean;
  cacheKey?: string;
  cacheFilePath?: string;
  contentLength?: number;
  oversized?: boolean;
}

export async function fetchPage(options: FetchOptions): Promise<FetchResult> {
  const { url, timeout, noCache, config, signal, onUpdate } = options;
  const jinaEnabled = config.jinaEnabled !== false;
  const minDelay = config['min-delay'] ?? 1000;
  const maxDelay = config['max-delay'] ?? 3000;
  const headingThreshold = config['heading-threshold'] ?? 40000;
  const contentThreshold = config['content-threshold'] ?? 100000;
  const cacheMaxFiles = config['cache-max-files'] ?? 100;

  const cache = createCache(
    `${process.env.HOME}/.pi/tools-cache/web_fetch`,
    3600,
    cacheMaxFiles,
  );

  const cacheKey = `fetch:${normalizeUrl(url)}`;

  // Check cache
  if (!noCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Delay for politeness
  await delay(minDelay + Math.random() * (maxDelay - minDelay));

  // Fetch with retry
  const { res, url: resolvedUrl } = await fetchWithRetry(url, timeout);
  const text = await res.text();

  // Cloudflare warning
  if (isCloudflareChallenge(text)) {
    onUpdate?.({ content: [{ type: 'text', text: 'Warning: Site is behind Cloudflare protection.' }] });
  }

  // ─── Content-type aware handling ───────────────────────────────────────
  const contentType = res.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    const jsonStr = JSON.stringify(JSON.parse(text), null, 2);
    const result: FetchResult = {
      text: jsonStr,
      resolvedUrl,
      title: '',
      source: 'json',
      truncated: false,
    };
    if (!noCache) cache.put(cacheKey, result);
    return result;
  }

  if (contentType.includes('text/plain')) {
    const result: FetchResult = {
      text,
      resolvedUrl,
      title: '',
      source: 'text',
      truncated: false,
    };
    if (!noCache) cache.put(cacheKey, result);
    return result;
  }

  // ─── HTML extraction pipeline ──────────────────────────────────────────
  let result: { bodyText: string; title: string; source: string } | null = null;

  // Step 1: Check for GitHub URLs
  if (isGitHubUrl(resolvedUrl)) {
    const githubResult = await fetchGitHubContent(text, resolvedUrl);
    if (githubResult) {
      result = githubResult;
    }
  }

  // Step 2: Detect protected/JS-heavy pages
  if (!result && !isProtectedOrJsHeavy(text)) {
    // Safe to try Defuddle
    try {
      const extraction = await extractWithDefuddle(text, resolvedUrl);
      result = {
        bodyText: extraction.bodyText,
        title: extraction.title,
        source: 'defuddle',
      };
    } catch (err) {
      onUpdate?.({ content: [{ type: 'text', text: `Defuddle error: ${err.message || err}` }] });
    }

    // If Defuddle produced poor results, try Jina
    if (!result || isDefuddleFailure({ ...result, author: '', description: '', date: '', lang: '' })) {
      if (!jinaEnabled) {
        onUpdate?.({ content: [{ type: 'text', text: 'Warning: Defuddle failed and Jina is disabled.' }] });
        result = { bodyText: text, title: '', source: 'raw' };
      } else {
        onUpdate?.({ content: [{ type: 'text', text: '[Defuddle returned low-quality content, trying Jina Reader...]' }] });
        try {
          const jinaResult = await fetchWithJina(resolvedUrl, timeout);
          result = { bodyText: jinaResult.bodyText, title: jinaResult.title, source: 'jina' };
        } catch (err) {
          onUpdate?.({ content: [{ type: 'text', text: `Jina Reader error: ${err.message || err}` }] });
          result = { bodyText: text, title: '', source: 'raw' };
        }
      }
    }
  } else if (!result && isProtectedOrJsHeavy(text)) {
    onUpdate?.({ content: [{ type: 'text', text: '[Detected bot protection / JS-heavy page, using Jina Reader directly...]' }] });
    if (!jinaEnabled) {
      onUpdate?.({ content: [{ type: 'text', text: 'Warning: Detected protected page and Jina is disabled.' }] });
      result = { bodyText: text, title: '', source: 'raw' };
    } else {
      try {
        const jinaResult = await fetchWithJina(resolvedUrl, timeout);
        result = { bodyText: jinaResult.bodyText, title: jinaResult.title, source: 'jina' };
      } catch (err) {
        onUpdate?.({ content: [{ type: 'text', text: `Jina Reader error: ${err.message || err}` }] });
        result = { bodyText: text, title: '', source: 'raw' };
      }
    }
  }

  if (!result) {
    result = { bodyText: text, title: '', source: 'raw' };
  }

  // Step 3: Smart truncation
  const truncatedResult = smartTruncate(result.bodyText, result.title || '', headingThreshold);

  // Step 4: Check if content exceeds threshold
  const contentLength = truncatedResult.bodyText.length;
  if (contentLength > contentThreshold) {
    const cacheFilePath = keyToPath(
      `${process.env.HOME}/.pi/tools-cache/web_fetch`,
      cacheKey,
    );
    const fetchResult: FetchResult = {
      text: truncatedResult.bodyText,
      resolvedUrl,
      title: truncatedResult.title || '',
      source: result.source || 'defuddle',
      truncated: truncatedResult.truncated,
      cacheKey: cacheKey,
      cacheFilePath: cacheFilePath,
      contentLength: contentLength,
      oversized: true,
    };

    // Cache the full result
    if (!noCache) {
      cache.put(cacheKey, fetchResult);
    }

    return fetchResult;
  }

  const fetchResult: FetchResult = {
    text: truncatedResult.bodyText,
    resolvedUrl,
    title: truncatedResult.title || '',
    source: result.source || 'defuddle',
    truncated: truncatedResult.truncated,
  };

  // Cache
  if (!noCache) {
    cache.put(cacheKey, fetchResult);
  }

  return fetchResult;
}