import { createCache } from '../cache';
import { keyToPath } from '../rate-limit';
import type { WebFetchConfig } from '../config';
import { pickRandom, delay, USER_AGENTS, ACCEPT_LANGUAGES } from '../user-agents';
import { extractHtmlContent } from './html-extraction';
import { isCloudflareChallenge } from './detection';
import { smartTruncate } from './truncate';
import { fetchWithRetry } from './retry';
import { normalizeUrl } from '../format';
import { isSafeUrl } from './security';
import type { ExtractionResult } from './html-extraction';

function getCacheDir(subdir: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!process.env.HOME && process.env.USERPROFILE) {
    console.warn('[web-fetch] HOME is undefined, using USERPROFILE for cache path');
  }
  return `${home}/.pi/tools-cache/${subdir}`;
}

export interface FetchPageOptions {
  url: string;
  timeout: number;
  noCache: boolean;
  config: WebFetchConfig;
  signal?: AbortSignal;
  onUpdate?: (update: { content: Array<{ type: string; text: string }> }) => void;
  headers?: Record<string, string>;
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

export async function fetchPage(options: FetchPageOptions): Promise<FetchResult> {
  const { url, timeout, noCache, config, signal, onUpdate, headers } = options;

  // Validate URL format — must have http:// or https:// scheme
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(`SSRF protection blocked request to ${url}: unsupported protocol '${parsedUrl.protocol}'`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('SSRF protection')) {
      throw e;
    }
    throw new Error(`SSRF protection blocked request to ${url}: invalid URL format`);
  }

  // SSRF protection — block private/reserved IPs and dangerous schemes
  if (!isSafeUrl(url)) {
    throw new Error(`SSRF protection blocked request to ${url}`);
  }

  const jinaEnabled = config.jinaEnabled !== false;
  const minDelay = config['min-delay'] ?? 1000;
  const maxDelay = config['max-delay'] ?? 3000;
  const headingThreshold = config['heading-threshold'] ?? 40000;
  const contentThreshold = config['content-threshold'] ?? 32000;
  const jinaTimeout = config['jina-timeout'] ?? 30000;
  const cacheMaxFiles = config['cache-max-files'] ?? 100;

  const cache = createCache(
    getCacheDir('web_fetch'),
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
  const { res, url: resolvedUrl } = await fetchWithRetry(url, timeout, headers);
  const text = await res.text();

  // Cloudflare warning
  if (isCloudflareChallenge(text)) {
    onUpdate?.({ content: [{ type: 'text', text: 'Warning: Site is behind Cloudflare protection.' }] });
  }

  // ─── Content-type aware handling ───────────────────────────────────────
  const contentType = res.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    try {
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
    } catch (e) {
      console.warn(`[web-fetch] JSON parse error for ${url}: ${e instanceof Error ? e.message : String(e)}`);
      // Fall through to treat as raw text
    }
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

  // ─── Binary content detection ──────────────────────────────────────────
  const binaryTypes = [
    'application/pdf',
    'image/',
    'application/octet-stream',
    'application/zip',
    'application/x-tar',
    'application/gzip',
    'application/x-bzip',
    'application/x-7z-compressed',
    'application/x-rar',
  ];

  for (const binaryType of binaryTypes) {
    if (contentType.includes(binaryType)) {
      let message: string;
      let source: string;

      if (contentType.includes('application/pdf')) {
        message = 'This is a PDF document. Use a PDF reader to view it.';
        source = 'pdf';
      } else if (contentType.includes('image/')) {
        message = 'This is an image file. Use an image viewer to view it.';
        source = 'image';
      } else if (contentType.includes('application/zip')) {
        message = 'This is a ZIP archive. Content cannot be displayed as text.';
        source = 'zip';
      } else if (contentType.includes('application/x-tar')) {
        message = 'This is a TAR archive. Content cannot be displayed as text.';
        source = 'tar';
      } else if (contentType.includes('application/gzip')) {
        message = 'This is a GZIP archive. Content cannot be displayed as text.';
        source = 'gzip';
      } else if (contentType.includes('application/x-bzip')) {
        message = 'This is a BZIP archive. Content cannot be displayed as text.';
        source = 'bzip';
      } else if (contentType.includes('application/x-7z-compressed')) {
        message = 'This is a 7Z archive. Content cannot be displayed as text.';
        source = '7z';
      } else if (contentType.includes('application/x-rar')) {
        message = 'This is a RAR archive. Content cannot be displayed as text.';
        source = 'rar';
      } else {
        message = 'This is a binary file. Content cannot be displayed as text.';
        source = 'binary';
      }

      const result: FetchResult = {
        text: message,
        resolvedUrl,
        title: '',
        source,
        truncated: false,
      };
      if (!noCache) cache.put(cacheKey, result);
      return result;
    }
  }

  // ─── HTML extraction pipeline ──────────────────────────────────────────
  const extractionResult: ExtractionResult = await extractHtmlContent(text, resolvedUrl, {
    jinaEnabled,
    jinaTimeout,
    headers,
    onUpdate,
  });

  // Step 3: Smart truncation
  const truncatedResult = smartTruncate(extractionResult.bodyText, extractionResult.title || '', headingThreshold);

  // Step 4: Check if content exceeds threshold
  const contentLength = truncatedResult.bodyText.length;
  if (contentLength > contentThreshold) {
    const cacheFilePath = keyToPath(
      getCacheDir('web_fetch'),
      cacheKey,
    );
    const fetchResult: FetchResult = {
      text: truncatedResult.bodyText,
      resolvedUrl,
      title: truncatedResult.title || '',
      source: extractionResult.source || 'defuddle',
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
    source: extractionResult.source || 'defuddle',
    truncated: truncatedResult.truncated,
  };

  // Cache
  if (!noCache) {
    cache.put(cacheKey, fetchResult);
  }

  return fetchResult;
}