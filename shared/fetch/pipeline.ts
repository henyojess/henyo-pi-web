import { createCache } from '../cache';
import { keyToPath } from '../rate-limit';
import type { WebFetchConfig } from '../config';
import { pickRandom, delay, USER_AGENTS, ACCEPT_LANGUAGES } from '../user-agents';
import { extractHtmlContent } from './html-extraction';
import { handleContent } from './content-handlers';
import { smartTruncate } from './truncate';
import { fetchWithRetry } from './retry';
import { normalizeUrl } from '../format';
import { isSafeUrl } from './security';
import type { ExtractionResult } from './html-extraction';

/** Format byte count to human-readable size label. */
export function formatSize(bytes: number): { contentLengthKB: number; sizeLabel: string } {
  const kb = bytes / 1024;
  if (kb < 1024) {
    return { contentLengthKB: Math.round(kb * 10) / 10, sizeLabel: `${Math.round(kb * 10) / 10} KB` };
  }
  const mb = kb / 1024;
  return { contentLengthKB: Math.round(mb * 100) / 100, sizeLabel: `${Math.round(mb * 100) / 100} MB` };
}

/** Create a FetchResult with size metadata pre-computed. */
export function makeResult(
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

function getCacheDir(subdir: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
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

/** Error category for fetch failures — used for UX display and actionable guidance. */
export type FetchErrorCategory = 'ssrf' | 'invalid-url' | 'network' | 'timeout' | 'size-exceeded' | 'extraction-failed' | 'cloudflare' | 'not-found' | 'forbidden' | 'bad-request' | 'server-error' | 'unknown';

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
  /** Original URL when the content came from the Wayback Machine fallback */
  originalUrl?: string;
  /** Snapshot capture date (YYYY-MM-DD) when served from the Wayback Machine */
  snapshotDate?: string;
}

/** True iff the error is a blocked HTTP response (401/403/503) as thrown by fetchWithRetry. */
function isBlockedHttpError(err: unknown): boolean {
  return err instanceof Error && /^HTTP (401|403|503):/.test(err.message);
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
  // Wayback fallback eligibility: enabled by config AND no caller Authorization header
  // (auth-protected fetches must not be silently replaced by archived public snapshots).
  const waybackEligible = config.waybackEnabled !== false && !headers?.Authorization;

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

  // Fetch with retry — on blocked (401/403/503) responses, fall back to the Wayback
  // Machine when eligible; if the archive attempt also fails, rethrow the original
  // error (never mask it).
  let waybackMode = false;
  let snapshotDate: string | undefined;
  let fetched: { res: Response; url: string };
  try {
    fetched = await fetchWithRetry(url, timeout, headers);
  } catch (err) {
    if (!isBlockedHttpError(err) || !waybackEligible) throw err;
    waybackMode = true;
    try {
      fetched = await fetchWithRetry(`https://web.archive.org/web/${url}`, timeout, headers);
      // Snapshot date (YYYY-MM-DD) from /web/<14-digit timestamp>/ in the resolved URL;
      // left undefined if the resolved URL carries no recognizable timestamp.
      const m = /\/web\/(\d{14})\//.exec(fetched.url);
      if (m) {
        const ts = m[1]!;
        snapshotDate = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
      }
    } catch {
      throw err; // Wayback failed — rethrow the original (direct) error
    }
  }
  const { res, url: resolvedUrl } = fetched;

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
  let rawBytes: Uint8Array | null = null;
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
      rawBytes = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        rawBytes.set(chunk, offset);
        offset += chunk.length;
      }
      const decoder = new TextDecoder();
      text = decoder.decode(rawBytes);
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

  // ─── Content-type routing (JSON, text, binary, PDF) ────────────────────
  const contentType = res.headers.get('Content-Type') || '';
  const contentResult = await handleContent({
    body: text,
    rawBytes,
    contentType,
    resolvedUrl,
    cacheKey,
    noCache,
    contentThreshold,
    cache,
  });
  if (contentResult) {
    return contentResult;
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

  // Wayback fallback: prepend the archive warning after truncation so the tag
  // cannot be lost to truncation, and override the extraction source.
  const resultText = waybackMode
    ? `⚠ Archived snapshot from ${snapshotDate ?? 'unknown date'} (Wayback Machine) — content may be stale. Original URL: ${url}\n\n` + truncatedResult.bodyText
    : truncatedResult.bodyText;
  const resultSource = waybackMode ? 'wayback' : (extractionResult.source || 'defuddle');
  const waybackMeta = waybackMode
    ? { originalUrl: url, ...(snapshotDate !== undefined ? { snapshotDate } : {}) }
    : {};

  // Step 4: Check if content exceeds threshold
  const contentLength = truncatedResult.bodyText.length;
  if (contentLength > contentThreshold) {
    const cacheFilePath = keyToPath(
      getCacheDir('henyo_fetch'),
      cacheKey,
    );
    const sizeInfo = formatSize(contentLength);
    const fetchResult: FetchResult = {
      text: resultText,
      resolvedUrl,
      title: truncatedResult.title || '',
      source: resultSource,
      truncated: truncatedResult.truncated,
      contentLengthKB: sizeInfo.contentLengthKB,
      sizeLabel: sizeInfo.sizeLabel,
      cacheKey: cacheKey,
      cacheFilePath: cacheFilePath,
      contentLength: contentLength,
      oversized: true,
      errorCategory: 'size-exceeded',
      ...waybackMeta,
    };

    // Cache the full result
    if (!noCache) {
      cache.put(cacheKey, fetchResult);
    }

    return fetchResult;
  }

  const sizeInfo = formatSize(contentLength);
  const cacheFilePath = keyToPath(getCacheDir('henyo_fetch'), cacheKey);
  const fetchResult: FetchResult = {
    text: resultText,
    resolvedUrl,
    title: truncatedResult.title || '',
    source: resultSource,
    truncated: truncatedResult.truncated,
    contentLengthKB: sizeInfo.contentLengthKB,
    sizeLabel: sizeInfo.sizeLabel,
    cacheFilePath,
    ...waybackMeta,
  };

  // Cache
  if (!noCache) {
    cache.put(cacheKey, fetchResult);
  }

  return fetchResult;
}