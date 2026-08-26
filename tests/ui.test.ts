import { buildCollapsedFetchHeader, buildErrorFetchHeader } from '../shared/fetch/ui';
import type { FetchResultUI } from '../shared/fetch/ui';
import type { Theme } from '@earendil-works/pi-coding-agent';

/**
 * Pass-through theme fake (plan item 5): fg returns the plain string so
 * assertions match unstyled output. `colors` records requested colors so
 * badge-color fallback behavior can be asserted on top of the plain output.
 */
function makeTheme() {
  const colors: string[] = [];
  const theme = {
    fg: (c: string, s: string) => {
      colors.push(c);
      return s;
    },
  } as unknown as Theme;
  return { theme, colors };
}

describe('buildCollapsedFetchHeader', () => {
  it('builds full header: url + title + source + sizeLabel', () => {
    const { theme, colors } = makeTheme();
    const ui: FetchResultUI = {
      url: 'https://example.com/a',
      title: 'My Title',
      source: 'defuddle',
      sizeLabel: '1.2 MB',
    };
    const out = buildCollapsedFetchHeader(ui, theme);
    expect(out).toBe('https://example.com/a  My Title  [defuddle]  1.2 MB');
    // url muted, known-source badge accent, sizeLabel muted
    expect(colors).toEqual(['muted', 'accent', 'muted']);
  });

  it('omits the size label part when absent', () => {
    const { theme } = makeTheme();
    const ui: FetchResultUI = { url: 'https://example.com/a', title: 'T', source: 'text' };
    expect(buildCollapsedFetchHeader(ui, theme)).toBe('https://example.com/a  T  [text]');
  });

  it('marks truncated results with [truncated]', () => {
    const { theme, colors } = makeTheme();
    const ui: FetchResultUI = {
      url: 'https://example.com/a',
      title: 'T',
      source: 'defuddle',
      truncated: true,
    };
    expect(buildCollapsedFetchHeader(ui, theme)).toBe(
      'https://example.com/a  T  [defuddle]  [truncated]',
    );
    expect(colors).toContain('warning');
  });

  it('oversized suppresses [truncated]', () => {
    const { theme, colors } = makeTheme();
    const ui: FetchResultUI = {
      url: 'https://example.com/a',
      title: 'T',
      source: 'defuddle',
      truncated: true,
      oversized: true,
    };
    expect(buildCollapsedFetchHeader(ui, theme)).toBe(
      'https://example.com/a  T  [defuddle]  [oversized]',
    );
    expect(colors.filter((c) => c === 'error')).toHaveLength(1);
  });

  it('appends [cached] when cached', () => {
    const { theme } = makeTheme();
    const ui: FetchResultUI = {
      url: 'https://example.com/a',
      source: 'defuddle',
      cached: true,
    };
    expect(buildCollapsedFetchHeader(ui, theme)).toBe(
      'https://example.com/a  [defuddle]  [cached]',
    );
  });

  it('appends [error] when error is set', () => {
    const { theme, colors } = makeTheme();
    const ui: FetchResultUI = {
      url: 'https://example.com/a',
      source: 'defuddle',
      error: 'timeout',
    };
    expect(buildCollapsedFetchHeader(ui, theme)).toBe(
      'https://example.com/a  [defuddle]  [timeout]',
    );
    // error status part rendered in error color
    expect(colors.at(-1)).toBe('error');
  });

  it('falls back to muted color for unknown sources', () => {
    const { theme, colors } = makeTheme();
    const ui: FetchResultUI = { url: 'https://example.com/a', source: 'unknown-src' };
    expect(buildCollapsedFetchHeader(ui, theme)).toBe('https://example.com/a  [unknown-src]');
    // url muted, badge falls back to muted (unknown source)
    expect(colors).toEqual(['muted', 'muted']);
  });

  it('omits the title part when title is empty', () => {
    const { theme } = makeTheme();
    const ui: FetchResultUI = { url: 'https://example.com/a', title: '', source: 'json' };
    expect(buildCollapsedFetchHeader(ui, theme)).toBe('https://example.com/a  [json]');
  });

  it('omits the status section when no flags are set', () => {
    const { theme } = makeTheme();
    const ui: FetchResultUI = {
      url: 'https://example.com/a',
      title: 'T',
      source: 'text',
      sizeLabel: '1 KB',
    };
    expect(buildCollapsedFetchHeader(ui, theme)).toBe('https://example.com/a  T  [text]  1 KB');
  });
});

describe('truncation edge cases (via header builders)', () => {
  it('leaves URLs of 50 chars or less untruncated', () => {
    const { theme } = makeTheme();
    const url = 'https://example.com/a'; // 21 chars
    expect(buildCollapsedFetchHeader({ url, source: 'text' }, theme)).toBe(
      `${url}  [text]`,
    );
  });

  it('keeps domain + tail for URLs > 50 chars with a path', () => {
    const { theme } = makeTheme();
    const url = `https://example.com/${'a'.repeat(50)}`; // 70 chars
    const out = buildCollapsedFetchHeader({ url, source: 'text' }, theme);
    // domain kept (slice excludes the '/' at domainEnd), '...', then last 25 path chars (47 total)
    expect(out).toBe(`https://example.com...${'a'.repeat(25)}  [text]`);
  });

  it('keeps domain + tail for URLs > 50 chars without a path', () => {
    const { theme } = makeTheme();
    const url = `https://${'h'.repeat(43)}`; // 51 chars, no '/' after host
    const out = buildCollapsedFetchHeader({ url, source: 'text' }, theme);
    expect(out).toBe(`https://${'h'.repeat(39)}...  [text]`);
  });

  it('falls back to head-truncation when the domain alone is near the limit', () => {
    // domainEnd (53) >= maxChars-3 (47): head-truncate, no tail kept
    const url = `https://${'h'.repeat(45)}/x`; // 54 chars
    const { theme } = makeTheme();
    const out = buildCollapsedFetchHeader({ url, source: 'text' }, theme);
    expect(out).toBe(`https://${'h'.repeat(39)}...  [text]`);
  });

  it('truncates titles longer than 60 chars to 57 + "..."', () => {
    const { theme } = makeTheme();
    const title = 'b'.repeat(65);
    const out = buildCollapsedFetchHeader({ url: 'https://example.com/a', title, source: 'text' }, theme);
    expect(out).toBe(`https://example.com/a  ${'b'.repeat(57)}...  [text]`);
  });
});

describe('buildErrorFetchHeader', () => {
  it('builds url + errorCategory badge + error message', () => {
    const { theme, colors } = makeTheme();
    const ui: FetchResultUI = {
      url: 'https://example.com/a',
      errorCategory: 'timeout',
      error: 'Upstream timeout after 30s',
    };
    expect(buildErrorFetchHeader(ui, theme)).toBe(
      'https://example.com/a  [timeout]  Upstream timeout after 30s',
    );
    // url muted, badge + message in error color
    expect(colors).toEqual(['muted', 'error', 'error']);
  });

  it('renders url-only when neither error nor errorCategory is set', () => {
    const { theme } = makeTheme();
    const ui: FetchResultUI = { url: 'https://example.com/a' };
    expect(buildErrorFetchHeader(ui, theme)).toBe('https://example.com/a');
  });

  it('renders url + error without the category badge when only error is set', () => {
    const { theme } = makeTheme();
    const ui: FetchResultUI = { url: 'https://example.com/a', error: 'boom' };
    expect(buildErrorFetchHeader(ui, theme)).toBe('https://example.com/a  boom');
  });
});
