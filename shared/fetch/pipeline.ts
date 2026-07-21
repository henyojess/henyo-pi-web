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
    console.warn('[henyo-fetch] HOME is undefined, using USERPROFILE for cache path');
  }
  return `${home}/.pi/tools-cache/${subdir}`;
}

/** Format byte count to human-readable size label. */
function formatSize(bytes: number): { contentLengthKB: number; sizeLabel: string } {
  const kb = bytes / 1024;
  if (kb < 1024) {
    return { contentLengthKB: Math.round(kb * 10) / 10, sizeLabel: `${Math.round(kb * 10) / 10} KB` };
  }
  const mb = kb / 1024;
  return { contentLengthKB: Math.round(mb * 100) / 100, sizeLabel: `${Math.round(mb * 100) / 100} MB` };
}

/** Create a FetchResult with size metadata pre-computed. */
function makeResult(
  base: Pick<FetchResult, 'resolvedUrl' | 'source' | 'truncated'>,
  text: string,
  title: string,
  contentLength?: number,
  extra?: Partial<FetchResult>,
): FetchResult {
  const sizeInfo = contentLength !== undefined ? formatSize(contentLength) : undefined;
  return {
    text,
    resolvedUrl: base.resolvedUrl,
    title,
    source: base.source,
    truncated: base.truncated,
    ...(sizeInfo ? { contentLengthKB: sizeInfo.contentLengthKB, sizeLabel: sizeInfo.sizeLabel } : {}),
    ...extra,
  };
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

/** Error category for fetch failures — used for UX display and actionable guidance. */
export type FetchErrorCategory = 'ssrf' | 'invalid-url' | 'network' | 'timeout' | 'size-exceeded' | 'extraction-failed' | 'cloudflare' | 'not-found' | 'forbidden' | 'server-error' | 'unknown';

export interface FetchResult {
  text: string;
  resolvedUrl: string;
  title: string;
  source: string;
  truncated: boolean;
  contentLengthKB?: number;
  sizeLabel?: string;
  cacheKey?: string;
  cacheFilePath?: string;
  contentLength?: number;
  oversized?: boolean;
  errorCategory?: FetchErrorCategory;
  cached?: boolean;
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
    throw new Error(`invalid URL format — use https://...`);
  }

  // SSRF protection — block private/reserved IPs and dangerous schemes
  if (!isSafeUrl(url)) {
    throw new Error(`ssrf blocked: ${url}`);
  }

  const jinaEnabled = config.jinaEnabled !== false;
  const minDelay = config['min-delay'] ?? 1000;
  const maxDelay = config['max-delay'] ?? 3000;
  const headingThreshold = config['heading-threshold'] ?? 40000;
  const contentThreshold = config['content-threshold'] ?? 32000;
  const jinaTimeout = config['jina-timeout'] ?? 30000;
  const maxResponseSize = config['max-response-size'] ?? 10485760; // 10MB default
  const cacheMaxFiles = config['cache-max-files'] ?? 100;

  const cache = createCache(
    getCacheDir('henyo_fetch'),
    3600,
    cacheMaxFiles,
  );

  const cacheKey = `fetch:${normalizeUrl(url)}`;

  // Check cache
  if (!noCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  // Delay for politeness
  await delay(minDelay + Math.random() * (maxDelay - minDelay));

  // Fetch with retry
  const { res, url: resolvedUrl } = await fetchWithRetry(url, timeout, headers);

  // Check max response size (Content-Length header as early check)
  const contentLengthHeader = res.headers.get('Content-Length');
  if (contentLengthHeader && parseInt(contentLengthHeader, 10) > maxResponseSize) {
    const sizeInfo = formatSize(parseInt(contentLengthHeader, 10));
    const result: FetchResult = {
      text: `Response exceeded max-response-size limit of ${maxResponseSize} bytes. Consider reducing content-threshold or using noCache to get a fresh fetch.`,
      resolvedUrl,
      title: '',
      source: 'size-exceeded',
      truncated: false,
      contentLengthKB: sizeInfo.contentLengthKB,
      sizeLabel: sizeInfo.sizeLabel,
    };
    if (!noCache) cache.put(cacheKey, result);
    return result;
  }

  // Stream the response with size limit
  const reader = res.body?.getReader();
  let text: string;
  if (reader) {
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.length;
        if (totalSize > maxResponseSize) {
          reader.releaseLock();
          throw new Error(`Response exceeded max-response-size limit of ${maxResponseSize} bytes. Consider reducing content-threshold or using noCache to get a fresh fetch.`);
        }
        chunks.push(value);
      }
      const decoder = new TextDecoder();
      const textBytes = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        textBytes.set(chunk, offset);
        offset += chunk.length;
      }
      text = decoder.decode(textBytes);
    } catch (e) {
      if (e instanceof Error && e.message.includes('max-response-size')) {
        const sizeInfo = formatSize(totalSize);
        const result: FetchResult = {
          text: e.message,
          resolvedUrl,
          title: '',
          source: 'size-exceeded',
          truncated: false,
          contentLengthKB: sizeInfo.contentLengthKB,
          sizeLabel: sizeInfo.sizeLabel,
        };
        if (!noCache) cache.put(cacheKey, result);
        return result;
      }
      throw e;
    }
  } else {
    // No body reader, fall back to text()
    text = await res.text();
  }

  // Cloudflare warning
  if (isCloudflareChallenge(text)) {
    onUpdate?.({ content: [{ type: 'text', text: 'Warning: Site is behind Cloudflare protection.' }] });
  }

  // ─── Content-type aware handling ───────────────────────────────────────
  const contentType = res.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    try {
      const jsonStr = JSON.stringify(JSON.parse(text), null, 2);
      const result: FetchResult = makeResult(
        { resolvedUrl, source: 'json', truncated: false },
        jsonStr,
        '',
        text.length,
      );
      if (!noCache) cache.put(cacheKey, result);
      return result;
    } catch (e) {
      console.warn(`[henyo-fetch] JSON parse error for ${url}: ${e instanceof Error ? e.message : String(e)}`);
      // Fall through to treat as raw text
    }
  }

  if (contentType.includes('text/plain')) {
    const result: FetchResult = makeResult(
      { resolvedUrl, source: 'text', truncated: false },
      text,
      '',
      text.length,
    );
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

      const result: FetchResult = makeResult(
        { resolvedUrl, source, truncated: false },
        message,
        '',
        text.length,
      );
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

  // Step 2.5: Title fallback — if extraction returned no title, derive from URL
  let title = extractionResult.title || '';
  if (!title || title === 'Untitled' || /^https?:\/\/[^/]+/i.test(title)) {
    try {
      const urlObj = new URL(resolvedUrl);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        title = pathParts[pathParts.length - 1]!.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      } else {
        title = urlObj.hostname.replace(/^www\./, '');
      }
    } catch {
      // URL parsing failed, keep empty title
    }
  }

  // Step 3: Smart truncation
  const truncatedResult = smartTruncate(extractionResult.bodyText, title, headingThreshold);

  // Step 4: Check if content exceeds threshold
  const contentLength = truncatedResult.bodyText.length;
  if (contentLength > contentThreshold) {
    const cacheFilePath = keyToPath(
      getCacheDir('henyo_fetch'),
      cacheKey,
    );
    const sizeInfo = formatSize(contentLength);
    const fetchResult: FetchResult = {
      text: truncatedResult.bodyText,
      resolvedUrl,
      title: truncatedResult.title || '',
      source: extractionResult.source || 'defuddle',
      truncated: truncatedResult.truncated,
      contentLengthKB: sizeInfo.contentLengthKB,
      sizeLabel: sizeInfo.sizeLabel,
      cacheKey: cacheKey,
      cacheFilePath: cacheFilePath,
      contentLength: contentLength,
      oversized: true,
      errorCategory: 'size-exceeded',
    };

    // Cache the full result
    if (!noCache) {
      cache.put(cacheKey, fetchResult);
    }

    return fetchResult;
  }

  const sizeInfo = formatSize(contentLength);
  const fetchResult: FetchResult = {
    text: truncatedResult.bodyText,
    resolvedUrl,
    title: truncatedResult.title || '',
    source: extractionResult.source || 'defuddle',
    truncated: truncatedResult.truncated,
    contentLengthKB: sizeInfo.contentLengthKB,
    sizeLabel: sizeInfo.sizeLabel,
  };

  // Cache
  if (!noCache) {
    cache.put(cacheKey, fetchResult);
  }

  return fetchResult;
}