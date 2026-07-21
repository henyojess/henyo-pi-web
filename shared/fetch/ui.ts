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
  content?: string;
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
 * Build expanded content text for a fetch result.
 * Includes the full content with a collapse hint.
 */
export function buildExpandedFetchContent(ui: FetchResultUI, theme: Theme, keyHintFn?: (action: string, label: string) => string): string {
  if (ui.oversized) {
    return buildOversizedCard(ui, theme);
  }

  const header = buildCollapsedFetchHeader(ui, theme);
  const content = ui.content || '';
  const collapseHint = keyHintFn ? keyHintFn('app.tools.expand', 'to collapse') : '[ctrl+e]';
  return `${header}\n\n${content}\n\n(${theme.fg('muted', 'press ' + collapseHint + ')')})`;
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
 * Build an oversized content card with metadata and guidance.
 */
function buildOversizedCard(ui: FetchResultUI, theme: Theme): string {
  const lines: string[] = [];

  // Title
  lines.push(theme.fg('warning', theme.bold('Content too large to display')));
  if (ui.sizeLabel) {
    lines.push(theme.fg('muted', `(${ui.sizeLabel})`));
  }
  lines.push('');

  // Metadata
  const url = truncateUrl(ui.url, 50);
  lines.push(`  ${theme.fg('muted', 'URL:')} ${url}`);
  if (ui.title) {
    lines.push(`  ${theme.fg('muted', 'Title:')} ${ui.title}`);
  }
  lines.push(`  ${theme.fg('muted', 'Source:')} ${ui.source}`);
  if (ui.sizeLabel) {
    lines.push(`  ${theme.fg('muted', 'Size:')}  ${ui.sizeLabel}`);
  }
  if (ui.cacheFilePath) {
    lines.push(`  ${theme.fg('muted', 'Cache:')} ${ui.cacheFilePath}`);
  }
  lines.push('');

  // Guidance
  lines.push(`  ${theme.fg('muted', 'The content was cached locally. You can:')}`);
  lines.push(`  ${theme.fg('muted', '  1. Reduce content-threshold in your config')}`);
  lines.push(`  ${theme.fg('muted', '  2. Use noCache: true to get a fresh fetch')}`);
  if (ui.cacheFilePath) {
    lines.push(`  ${theme.fg('muted', `  3. Check the cache file at: ${ui.cacheFilePath}`)}`);
  }

  return lines.join('\n');
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