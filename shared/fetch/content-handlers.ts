import { keyToPath } from '../rate-limit';
import type { FetchResult } from './pipeline';
import { extractPdfContent } from './pdf-extract';
import { formatSize, makeResult } from './pipeline';

/** Binary type message/source map. */
const BINARY_HANDLERS: Record<string, { message: string; source: string }> = {
  'image/': { message: 'This is an image file. Use an image viewer to view it.', source: 'image' },
  'application/zip': { message: 'This is a ZIP archive. Content cannot be displayed as text.', source: 'zip' },
  'application/x-tar': { message: 'This is a TAR archive. Content cannot be displayed as text.', source: 'tar' },
  'application/gzip': { message: 'This is a GZIP archive. Content cannot be displayed as text.', source: 'gzip' },
  'application/x-bzip': { message: 'This is a BZIP archive. Content cannot be displayed as text.', source: 'bzip' },
  'application/x-7z-compressed': { message: 'This is a 7Z archive. Content cannot be displayed as text.', source: '7z' },
  'application/x-rar': { message: 'This is a RAR archive. Content cannot be displayed as text.', source: 'rar' },
};

/** Cache directory helper. */
function getCacheDir(subdir: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  return `${home}/.pi/tools-cache/${subdir}`;
}

/** Check if body starts with PDF magic bytes. */
function isPdfBody(body: string): boolean {
  const trimmed = body.trimStart();
  return trimmed.startsWith('%PDF');
}

/**
 * Handle non-HTML content types: JSON, text/plain, binary, and PDF.
 * Returns null for unhandled types (e.g. HTML falls through).
 */
export async function handleContent(options: {
  body: string;
  rawBytes: Uint8Array | null;
  contentType: string;
  resolvedUrl: string;
  cacheKey: string;
  noCache: boolean;
  contentThreshold: number;
  cache: ReturnType<typeof import('../cache').createCache>;
}): Promise<FetchResult | null> {
  const { body, rawBytes, contentType, resolvedUrl, cacheKey, noCache, contentThreshold, cache } = options;

  // ─── JSON ──────────────────────────────────────────────────────────────
  if (contentType.includes('application/json')) {
    try {
      const jsonStr = JSON.stringify(JSON.parse(body), null, 2);
      const jsonLength = jsonStr.length;
      if (jsonLength > contentThreshold) {
        const cacheFilePath = keyToPath(getCacheDir('henyo_fetch'), cacheKey);
        const sizeInfo = formatSize(jsonLength);
        const fetchResult: FetchResult = {
          text: `JSON response exceeded content-threshold limit of ${contentThreshold} characters.`,
          resolvedUrl, title: '', source: 'json', truncated: false,
          contentLengthKB: sizeInfo.contentLengthKB, sizeLabel: sizeInfo.sizeLabel,
          cacheKey, cacheFilePath, contentLength: jsonLength,
          oversized: true, errorCategory: 'size-exceeded',
        };
        if (!noCache) cache.put(cacheKey, fetchResult);
        return fetchResult;
      }
      const result: FetchResult = makeResult(
        { resolvedUrl, source: 'json', truncated: false }, jsonStr, '', jsonLength,
      );
      if (!noCache) cache.put(cacheKey, result);
      return result;
    } catch { /* fall through to treat as raw text */ }
  }

  // ─── Plain text ────────────────────────────────────────────────────────
  if (contentType.includes('text/plain')) {
    const result: FetchResult = makeResult(
      { resolvedUrl, source: 'text', truncated: false }, body, '', body.length,
    );
    if (!noCache) cache.put(cacheKey, result);
    return result;
  }

  // ─── Binary content detection ──────────────────────────────────────────
  const binaryTypes = [
    'application/pdf', 'image/', 'application/octet-stream',
    'application/zip', 'application/x-tar', 'application/gzip',
    'application/x-bzip', 'application/x-7z-compressed', 'application/x-rar',
  ];

  for (const binaryType of binaryTypes) {
    if (contentType.includes(binaryType)) {
      // PDF: check content-type or magic bytes (%PDF header)
      const isPdf = contentType.includes('application/pdf') || isPdfBody(body);
      if (isPdf) {
        // Use raw bytes for PDF extraction (string conversion corrupts binary data)
        const pdfBytes = rawBytes || new Uint8Array(body.length);
        if (!rawBytes) {
          for (let i = 0; i < body.length; i++) {
            pdfBytes[i] = body.charCodeAt(i);
          }
        }
        const pdfResult = await extractPdfContent(pdfBytes);
        const pdfContentLength = pdfResult.text.length;

        if (pdfContentLength > contentThreshold) {
          const cacheFilePath = keyToPath(getCacheDir('henyo_fetch'), cacheKey);
          const sizeInfo = formatSize(pdfContentLength);
          const fetchResult: FetchResult = {
            text: pdfResult.text, resolvedUrl, title: pdfResult.title || '',
            source: 'pdf', truncated: false,
            contentLengthKB: sizeInfo.contentLengthKB, sizeLabel: sizeInfo.sizeLabel,
            cacheKey, cacheFilePath, contentLength: pdfContentLength,
            oversized: true, errorCategory: 'size-exceeded',
          };
          if (!noCache) cache.put(cacheKey, fetchResult);
          return fetchResult;
        }

        const sizeInfo = formatSize(pdfContentLength);
        const result: FetchResult = {
          text: pdfResult.text, resolvedUrl, title: pdfResult.title || '',
          source: 'pdf', truncated: false,
          contentLengthKB: sizeInfo.contentLengthKB, sizeLabel: sizeInfo.sizeLabel,
          cached: false,
        };
        if (!noCache) cache.put(cacheKey, result);
        return result;
      }

      // Other binary types: lookup in map, default fallback
      let message: string, source: string;
      for (const [key, handler] of Object.entries(BINARY_HANDLERS)) {
        if (contentType.includes(key)) { message = handler.message; source = handler.source; break; }
      }
      if (!message) { message = 'This is a binary file. Content cannot be displayed as text.'; source = 'binary'; }
      trace(`→ binary fallback: source="${source}" message="${message}"`);

      const result: FetchResult = makeResult(
        { resolvedUrl, source, truncated: false }, message, '', body.length,
      );
      if (!noCache) cache.put(cacheKey, result);
      return result;
    }
  }

  // Not a handled content type — fall through to HTML extraction
  return null;
}