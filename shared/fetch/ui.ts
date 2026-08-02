import type { Theme } from '@earendil-works/pi-coding-agent';

/**
 * UI-friendly representation of a FetchResult for TUI rendering.
 * Contains only display-relevant fields.
 */
export interface FetchResultUI {
  url: string;
  title: string;
  source: string;
  sizeLabel?: string;
  contentLengthKB?: number;
  truncated?: boolean;
  oversized?: boolean;
  cached?: boolean;
  cacheFilePath?: string;
  error?: string;
  errorCategory?: string;
}

/** Source badge color mapping. */
const SOURCE_COLORS: Record<string, string> = {
  defuddle: 'accent',
  jina: 'success',
  github: 'accent',
  json: 'muted',
  text: 'muted',
  pdf: 'muted',
  image: 'muted',
  zip: 'muted',
  tar: 'muted',
  gzip: 'muted',
  bzip: 'muted',
  '7z': 'muted',
  rar: 'muted',
  binary: 'muted',
  'size-exceeded': 'error',
};

/**
 * Build a collapsed header line for a fetch result.
 * Format: URL  Title  [source]  size  [flags]  (hint)
 */
export function buildCollapsedFetchHeader(ui: FetchResultUI, theme: Theme): string {
  const parts: string[] = [];

  // URL (muted, truncated if too long)
  const url = truncateUrl(ui.url, 50);
  parts.push(theme.fg('muted', url));

  // Title (default color, truncated to 60 chars)
  if (ui.title) {
    const title = truncateTo(ui.title, 60);
    parts.push(title);
  }

  // Source badge
  const color = SOURCE_COLORS[ui.source] || 'muted';
  parts.push(theme.fg(color, `[${ui.source}]`));

  // Size label
  if (ui.sizeLabel) {
    parts.push(theme.fg('muted', ui.sizeLabel));
  }

  // Status indicators
  const statusParts: string[] = [];
  if (ui.oversized) {
    statusParts.push(theme.fg('error', '[oversized]'));
  } else if (ui.truncated) {
    statusParts.push(theme.fg('warning', '[truncated]'));
  }
  if (ui.cached) {
    statusParts.push(theme.fg('muted', '[cached]'));
  }
  if (ui.error) {
    statusParts.push(theme.fg('error', `[${ui.error}]`));
  }
  if (statusParts.length > 0) {
    parts.push(statusParts.join(' '));
  }

  return parts.join('  ');
}

/**
 * Build an error header line for fetch failures.
 */
export function buildErrorFetchHeader(ui: FetchResultUI, theme: Theme): string {
  const parts: string[] = [];

  // URL
  const url = truncateUrl(ui.url, 50);
  parts.push(theme.fg('muted', url));

  // Error category badge
  if (ui.errorCategory) {
    parts.push(theme.fg('error', `[${ui.errorCategory}]`));
  }

  // Error message
  if (ui.error) {
    parts.push(theme.fg('error', ui.error));
  }

  return parts.join('  ');
}

/**
 * Truncate a URL to maxChars, adding '...' if truncated.
 */
function truncateUrl(url: string, maxChars: number): string {
  if (url.length <= maxChars) return url;
  // Keep the protocol and domain, truncate the path
  const domainEnd = url.indexOf('/', url.indexOf('://') + 3);
  if (domainEnd === -1 || domainEnd >= maxChars - 3) {
    return url.slice(0, maxChars - 3) + '...';
  }
  return url.slice(0, domainEnd) + '...' + url.slice(-Math.max(0, maxChars - domainEnd - 3 - 3));
}

/**
 * Truncate any string to maxChars, adding '...' if truncated.
 */
function truncateTo(str: string, maxChars: number): string {
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars - 3) + '...';
}