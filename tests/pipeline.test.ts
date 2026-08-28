import { fetchPage, formatSize } from '../shared/fetch/pipeline';
import type { WebFetchConfig } from '../shared/config';

// Mock extract and github modules to avoid real network calls
vi.mock('../shared/fetch/extract', () => ({
  extractWithDefuddle: vi.fn(),
  fetchWithJina: vi.fn(),
}));

vi.mock('../shared/fetch/github', () => ({
  isGitHubUrl: vi.fn(),
  fetchGitHubContent: vi.fn(),
}));

import { extractWithDefuddle, fetchWithJina } from '../shared/fetch/extract';

describe('fetchPage', () => {
  const config: WebFetchConfig = {
    jinaEnabled: true,
    'min-delay': 0,
    'max-delay': 0,
    'cache-max-files': 100,
    'heading-threshold': 40000,
  };

  const mockHtml = '<html><head><title>Test</title></head><body><p>Content here with enough text to not be flagged as a defuddle failure and has sufficient length for proper extraction testing purposes.</p></body></html>';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: set up a default HTML fetch mock
  const mockHtmlFetch = (extraChecks: (url: string) => boolean = () => false, extraResponse?: (url: string) => Response) => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('r.jina.ai')) throw new Error('Unexpected Jina fetch');
      if (extraChecks(url)) return extraResponse?.(url) || new Response('');
      const res = new Response(mockHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
      // Response.url is read-only in Node.js, so we define it
      Object.defineProperty(res, 'url', { value: url, writable: false, configurable: true });
      return res;
    });
  };

  // Helper: set up a custom fetch mock
  const mockFetch = (fn: (url: string) => Response | Promise<Response>) => {
    vi.stubGlobal('fetch', fn);
  };

  // ─── Network error tests ───────────────────────────────────────────────

  it('throws on invalid URL', async () => {
    await expect(fetchPage({ url: 'not-a-url', timeout: 5000, noCache: true, config })).rejects.toThrow();
  });

  it('throws on non-existent domain', async () => {
    await expect(fetchPage({ url: 'https://this-domain-does-not-exist-12345.com', timeout: 2000, noCache: true, config })).rejects.toThrow();
  });

  // ─── Cache tests ───────────────────────────────────────────────────────

  it('caches results on second call', async () => {
    mockHtmlFetch();
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: 'Cached content with enough text to pass quality checks for the extraction pipeline.',
      title: 'Cached Title',
      author: '', description: '', date: '', lang: '',
    });
    const result1 = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: false, config });
    const result2 = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: false, config });
    expect(result2.text).toBe(result1.text); // same content from cache
    expect(result2.source).toBe(result1.source);
  });

  it('marks cached results with cached: true flag', async () => {
    // Clear cache to avoid interference from previous tests
    const { createCache } = await import('../shared/cache');
    const testCache = createCache(
      `${process.env.HOME}/.pi/tools-cache/henyo_fetch`,
      3600,
      100,
    );
    testCache.clear();

    mockHtmlFetch();
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: 'Cached content with enough text to pass quality checks for the extraction pipeline.',
      title: 'Cached Title',
      author: '', description: '', date: '', lang: '',
    });
    const result1 = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: false, config });
    const result2 = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: false, config });
    expect(result1.cached).toBeUndefined(); // first call is not cached
    expect(result2.cached).toBe(true); // second call is from cache
  });

  it('skips cache with noCache: true', async () => {
    mockHtmlFetch();
    let callCount = 0;
    (extractWithDefuddle as any).mockImplementation(async () => {
      callCount++;
      return { bodyText: `This is content from call #${callCount} with enough text to pass the defuddle quality check and ensure the extraction result is considered valid by the pipeline.`, title: 'Test', author: '', description: '', date: '', lang: '' };
    });
    const result1 = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config });
    const result2 = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config });
    expect(result1.text).toContain('call #1');
    expect(result2.text).toContain('call #2');
    expect(callCount).toBe(2); // Defuddle called twice (not cached)
  });

  it('caches result when noCache is false', async () => {
    // Clear any existing cache entries that might interfere
    const { createCache } = await import('../shared/cache');
    const testCache = createCache(
      `${process.env.HOME}/.pi/tools-cache/henyo_fetch`,
      3600,
      100,
    );
    testCache.clear();

    mockHtmlFetch();
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: 'This content is long enough to pass the quality threshold for extraction and be considered a valid result by the pipeline. It has sufficient length and a proper title to avoid being flagged as a defuddle failure result during quality checks.',
      title: 'Cache Test',
      author: '', description: '', date: '', lang: '',
    });
    const uniqueUrl = 'https://example-cache-test.com';
    const result = await fetchPage({ url: uniqueUrl, timeout: 10000, noCache: false, config });
    expect(result.source).toBe('defuddle');
    // Second call should hit cache — no fetch should be made
    let fetchCalled = false;
    vi.stubGlobal('fetch', async () => { fetchCalled = true; return new Response(''); });
    const cachedResult = await fetchPage({ url: uniqueUrl, timeout: 10000, noCache: false, config });
    expect(cachedResult.text).toBe(result.text);
    expect(cachedResult.source).toBe(result.source);
    expect(fetchCalled).toBe(false); // cached, no network call
  });

  // ─── Content-type routing ──────────────────────────────────────────────

  it('handles JSON content type response', async () => {
    mockFetch(async () => new Response('{"key":"value","num":42}', {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const result = await fetchPage({ url: 'https://example.com/api', timeout: 10000, noCache: true, config });
    expect(result.source).toBe('json');
    expect(result.text).toContain('"key"');
    expect(result.text).toContain('"value"');
    expect(result.text).toContain('"num"');
    expect(result.text).toContain('42');
  });

  it('returns oversized:true when JSON exceeds contentThreshold', async () => {
    const largeJson = JSON.stringify({ data: 'x'.repeat(150000) }, null, 2);
    mockFetch(async () => new Response(largeJson, {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const result = await fetchPage({
      url: 'https://example.com/large-json',
      timeout: 10000,
      noCache: true,
      config: { ...config, 'content-threshold': 32000 },
    });
    expect(result.oversized).toBe(true);
    expect(result.source).toBe('json');
    expect(result.cacheKey).toBeDefined();
    expect(result.cacheFilePath).toBeDefined();
    expect(result.cacheFilePath).toContain('.pi/tools-cache/henyo_fetch/');
    expect(result.errorCategory).toBe('size-exceeded');
    expect(result.contentLengthKB).toBeDefined();
    expect(result.sizeLabel).toBeDefined();
  });

  it('returns normal JSON when under contentThreshold', async () => {
    const smallJson = JSON.stringify({ key: 'value', items: Array(10).fill('test') }, null, 2);
    mockFetch(async () => new Response(smallJson, {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const result = await fetchPage({
      url: 'https://example.com/small-json',
      timeout: 10000,
      noCache: true,
      config: { ...config, 'content-threshold': 32000 },
    });
    expect(result.oversized).toBeUndefined();
    expect(result.source).toBe('json');
    expect(result.text).toContain('"key"');
    expect(result.text).toContain('"value"');
  });

  it('handles text/plain content type response', async () => {
    mockFetch(async () => new Response('Plain text content here', {
      status: 200, headers: { 'Content-Type': 'text/plain' },
    }));
    const result = await fetchPage({ url: 'https://example.com/raw', timeout: 10000, noCache: true, config });
    expect(result.source).toBe('text');
    expect(result.text).toBe('Plain text content here');
  });

  // ─── Cloudflare detection ──────────────────────────────────────────────

  it('detects Cloudflare challenge and warns', async () => {
    const updates: any[] = [];
    // Use HTML that triggers Cloudflare warning but NOT protection detection
    mockFetch(async () => new Response(
      '<html><body><form action="/checkpoint" id="challenge-form">Checking your browser before accessing the site.</form></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    ));
    (extractWithDefuddle as any).mockRejectedValue(new Error('defuddle error'));
    (fetchWithJina as any).mockResolvedValue({ title: 'Recovered', bodyText: 'Content recovered by Jina after Defuddle failed on the protected page.' });

    const result = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config, onUpdate: (u) => updates.push(u) });
    // Cloudflare warning suppressed — no intermediate messages
    expect(updates).toHaveLength(0);
    expect(result.source).toBe('jina');
  });

  it('handles Cloudflare warning with successful Defuddle (no Jina needed)', async () => {
    const updates: any[] = [];
    // Use HTML that triggers Cloudflare warning but NOT protection detection
    mockFetch(async () => new Response(
      '<html><body><form action="/checkpoint" id="challenge-form">Checking your browser before accessing the site.</form></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    ));
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: 'This content is long enough to pass the quality threshold for extraction and be considered a valid result by the pipeline. It has sufficient length and a proper title to avoid being flagged as a defuddle failure result.',
      title: 'Cloudflare Test',
      author: '', description: '', date: '', lang: '',
    });
    const result = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config, onUpdate: (u) => updates.push(u) });
    // Cloudflare warning suppressed — no intermediate messages
    expect(updates).toHaveLength(0);
    expect(result.source).toBe('defuddle');
  });

  // ─── Truncation ────────────────────────────────────────────────────────

  it('uses custom headingThreshold for truncation', async () => {
    mockHtmlFetch();
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: '# First Heading\nSome content here that makes the text longer.\n# Second Heading\nMore content here to add length.\n# Third Heading\nEven more content to reach the threshold.\n# Fourth Heading\nFinal section of content.',
      title: 'Threshold Test',
      author: '', description: '', date: '', lang: '',
    });
    const lowThresholdConfig: WebFetchConfig = {
      ...config,
      'heading-threshold': 10,
    };
    const result = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config: lowThresholdConfig });
    // With a very low threshold, truncation should kick in at the second heading
    expect(result.truncated).toBe(true);
  });

  // ─── Oversized content ─────────────────────────────────────────────────

  it('returns oversized result when content exceeds content-threshold', async () => {
    mockHtmlFetch();
    const largeContent = 'x'.repeat(150000); // 150KB, exceeds default 32KB threshold
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: largeContent,
      title: 'Large Page',
      author: '', description: '', date: '', lang: '',
    });
    const result = await fetchPage({
      url: 'https://example.com/large',
      timeout: 10000,
      noCache: true,
      config: { ...config, 'content-threshold': 32000 },
    });
    expect(result.oversized).toBe(true);
    expect(result.cacheKey).toBeDefined();
    expect(result.cacheFilePath).toBeDefined();
    expect(result.cacheFilePath).toContain('.pi/tools-cache/henyo_fetch/');
    expect(result.cacheFilePath).toContain('.json');
    expect(result.contentLength).toBe(largeContent.length);
  });

  it('returns normal result when content is under content-threshold', async () => {
    mockHtmlFetch();
    const smallContent = 'Small content'.repeat(100); // ~1200 chars, well under 32KB
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: smallContent,
      title: 'Small Page',
      author: '', description: '', date: '', lang: '',
    });
    const result = await fetchPage({
      url: 'https://example.com/small',
      timeout: 10000,
      noCache: true,
      config: { ...config, 'content-threshold': 32000 },
    });
    expect(result.oversized).toBeUndefined();
    expect(result.cacheKey).toBeUndefined();
    expect(result.contentLength).toBeUndefined();
    expect(result.text).toBe(smallContent);
  });

  it('uses custom content-threshold from config', async () => {
    mockHtmlFetch();
    const mediumContent = 'y'.repeat(50000); // 50KB
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: mediumContent,
      title: 'Medium Page',
      author: '', description: '', date: '', lang: '',
    });
    // With a 30KB threshold, 50KB should be oversized
    const lowThresholdConfig: WebFetchConfig = { ...config, 'content-threshold': 30000 };
    const result = await fetchPage({
      url: 'https://example.com/medium',
      timeout: 10000,
      noCache: true,
      config: lowThresholdConfig,
    });
    expect(result.oversized).toBe(true);
    expect(result.contentLength).toBe(mediumContent.length);
    expect(result.cacheFilePath).toBeDefined();
  });

  it('caches oversized result with noCache: false', async () => {
    const { createCache } = await import('../shared/cache');
    const testCache = createCache(
      `${process.env.HOME}/.pi/tools-cache/henyo_fetch`,
      3600,
      100,
    );
    testCache.clear();

    mockHtmlFetch();
    const largeContent = 'z'.repeat(120000);
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: largeContent,
      title: 'Cached Large',
      author: '', description: '', date: '', lang: '',
    });
    const uniqueUrl = 'https://example-cache-large.com';
    const result = await fetchPage({
      url: uniqueUrl,
      timeout: 10000,
      noCache: false,
      config: { ...config, 'content-threshold': 32000 },
    });
    expect(result.oversized).toBe(true);
    expect(result.cacheKey).toBeDefined();

    // Second call should hit cache
    let fetchCalled = false;
    vi.stubGlobal('fetch', async () => { fetchCalled = true; return new Response(''); });
    const cachedResult = await fetchPage({
      url: uniqueUrl,
      timeout: 10000,
      noCache: false,
      config: { ...config, 'content-threshold': 32000 },
    });
    expect(cachedResult.text).toBe(result.text);
    expect(cachedResult.cacheKey).toBe(result.cacheKey);
    expect(fetchCalled).toBe(false);
  });

  it('returns default content-threshold when not configured', async () => {
    mockHtmlFetch();
    const largeContent = 'w'.repeat(150000);
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: largeContent,
      title: 'Default Threshold',
      author: '', description: '', date: '', lang: '',
    });
    // No content-threshold set — should use default 32KB
    const result = await fetchPage({
      url: 'https://example.com/default',
      timeout: 10000,
      noCache: true,
      config,
    });
    expect(result.oversized).toBe(true);
    expect(result.contentLength).toBe(largeContent.length);
    expect(result.cacheFilePath).toBeDefined();
  });

  // ─── max-response-size ───────────────────────────────────────────────

  it('rejects early when Content-Length header exceeds max-response-size', async () => {
    mockFetch(async () => new Response('tiny', {
      status: 200,
      headers: { 'Content-Length': '99999999', 'Content-Type': 'text/html' },
    }));
    const result = await fetchPage({
      url: 'https://example.com/big-header',
      timeout: 10000,
      noCache: false,
      config,
    });
    expect(result.source).toBe('size-exceeded');
    expect(result.text).toContain('exceeded max-response-size limit of 10485760 bytes');
  });

  it('rejects mid-stream when streamed body exceeds max-response-size (no Content-Length)', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(60));
        controller.enqueue(new Uint8Array(60));
        controller.enqueue(new Uint8Array(60)); // 180 total > 100 limit
        controller.close();
      },
    });
    mockFetch(async () => new Response(stream, { status: 200 }));
    const result = await fetchPage({
      url: 'https://example.com/stream-big',
      timeout: 10000,
      noCache: false,
      config: { ...config, 'max-response-size': 100 },
    });
    expect(result.source).toBe('size-exceeded');
    expect(result.text).toContain('exceeded max-response-size limit of 100 bytes');
    expect(result.sizeLabel).toBeDefined();
  });

  it('re-throws non-size stream errors', async () => {
    let sent = false;
    const badStream = new ReadableStream({
      pull(controller) {
        if (!sent) { sent = true; controller.enqueue(new Uint8Array(10)); return; }
        throw new Error('network blip');
      },
    });
    mockFetch(async () => new Response(badStream, { status: 200 }));
    await expect(fetchPage({
      url: 'https://example.com/stream-err',
      timeout: 10000,
      noCache: true,
      config: { ...config, 'max-response-size': 1000 },
    })).rejects.toThrow('network blip');
  });

  // ─── Title fallback ────────────────────────────────────────────────────

  const defuddleOk = (title: string) => ({
    bodyText: 'This content is long enough to pass the quality threshold for extraction and be considered a valid result by the pipeline with a proper structure.',
    title,
    author: '', description: '', date: '', lang: '',
  });

  it('derives the title from the URL path when Defuddle returns an empty title', async () => {
    mockHtmlFetch();
    (extractWithDefuddle as any).mockResolvedValue(defuddleOk(''));
    // Keep Jina out of the way so the extraction result keeps an empty title
    (fetchWithJina as any).mockRejectedValue(new Error('jina unused in this test'));
    const result = await fetchPage({
      url: 'https://example.com/docs/my_report_v2.pdf',
      timeout: 10000,
      noCache: true,
      config,
    });
    expect(result.title).toBe('My Report V2.Pdf');
  });

  it('derives the title from the URL path when Defuddle returns "Untitled"', async () => {
    mockHtmlFetch();
    (extractWithDefuddle as any).mockResolvedValue(defuddleOk('Untitled'));
    (fetchWithJina as any).mockRejectedValue(new Error('jina unused in this test'));
    const result = await fetchPage({
      url: 'https://example.com/docs/my_report_v2.pdf',
      timeout: 10000,
      noCache: true,
      config,
    });
    expect(result.title).toBe('My Report V2.Pdf');
  });

  it('derives the title from the URL path when Defuddle returns a bare URL as title', async () => {
    mockHtmlFetch();
    (extractWithDefuddle as any).mockResolvedValue(defuddleOk('https://example.com'));
    (fetchWithJina as any).mockRejectedValue(new Error('jina unused in this test'));
    const result = await fetchPage({
      url: 'https://example.com/docs/my_report_v2.pdf',
      timeout: 10000,
      noCache: true,
      config,
    });
    expect(result.title).toBe('My Report V2.Pdf');
  });

  // ─── Misc small branches ────────────────────────────────────────────────

  it('falls back to res.text() when the response has no body reader', async () => {
    mockFetch(async () => new Response(null, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    (extractWithDefuddle as any).mockResolvedValue(defuddleOk('No Body'));
    const result = await fetchPage({
      url: 'https://example.com/no-body-reader',
      timeout: 10000,
      noCache: true,
      config,
    });
    expect(result.source).toBe('defuddle');
    expect(result.title).toBe('No Body');
  });

  it('rejects unsupported protocols with the SSRF message', async () => {
    await expect(fetchPage({ url: 'file:///etc/passwd', timeout: 1000, noCache: true, config }))
      .rejects.toThrow("SSRF protection blocked request to file:///etc/passwd: unsupported protocol 'file:'");
  });

  it('rejects unsafe URLs (private IP) before fetching', async () => {
    await expect(fetchPage({ url: 'https://10.0.0.5/x', timeout: 1000, noCache: true, config }))
      .rejects.toThrow('ssrf blocked');
  });

  // ─── Wayback Machine fallback ──────────────────────────────────────────

  it('A: falls back to Wayback on 403 and tags the archived result', async () => {
    const directUrl = 'https://example.com/';
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      if (url === 'https://web.archive.org/web/https://example.com/') {
        const res = new Response(mockHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
        // Response.url is read-only in Node.js — define the redirected snapshot URL
        Object.defineProperty(res, 'url', {
          value: 'https://web.archive.org/web/20250224123656/https://example.com/',
          configurable: true,
        });
        return res;
      }
      return new Response('Blocked by Cloudflare', { status: 403 });
    });
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: 'This content is long enough to pass the quality threshold for extraction and be considered a valid result by the pipeline.',
      title: 'Archived Page',
      author: '', description: '', date: '', lang: '',
    });
    const result = await fetchPage({ url: directUrl, timeout: 10000, noCache: true, config });
    expect(requested).toEqual([directUrl, 'https://web.archive.org/web/https://example.com/']);
    expect(result.source).toBe('wayback');
    expect(result.snapshotDate).toBe('2025-02-24');
    expect(result.originalUrl).toBe(directUrl);
    expect(result.text.startsWith('⚠ Archived snapshot from 2025-02-24')).toBe(true);
  });

  it('B: does not try Wayback when waybackEnabled is false', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      return new Response('Blocked', { status: 403 });
    });
    await expect(fetchPage({
      url: 'https://example.com/b', timeout: 10000, noCache: true,
      config: { ...config, waybackEnabled: false },
    })).rejects.toThrow('HTTP 403');
    expect(requested).toEqual(['https://example.com/b']);
  });

  it('C: does not try Wayback when the caller sends an Authorization header', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      return new Response('Blocked', { status: 403 });
    });
    await expect(fetchPage({
      url: 'https://example.com/c', timeout: 10000, noCache: true, config,
      headers: { Authorization: 'Bearer x' },
    })).rejects.toThrow('HTTP 403');
    expect(requested).toEqual(['https://example.com/c']);
  });

  it('D: rethrows the original 403 error when the Wayback fetch also fails', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('https://web.archive.org/web/')) {
        return new Response('No snapshot', { status: 404 });
      }
      return new Response('Blocked', { status: 403 });
    });
    await expect(fetchPage({ url: 'https://example.com/d', timeout: 10000, noCache: true, config }))
      .rejects.toThrow('HTTP 403');
  });

  it('E: makes exactly one fetch call for a normal 200 (no Wayback tags)', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      const res = new Response(mockHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
      Object.defineProperty(res, 'url', { value: url, configurable: true });
      return res;
    });
    (extractWithDefuddle as any).mockResolvedValue(defuddleOk('Normal Page'));
    const result = await fetchPage({ url: 'https://example.com/e', timeout: 10000, noCache: true, config });
    expect(requested).toEqual(['https://example.com/e']);
    expect(result.source).toBe('defuddle');
    expect(result.originalUrl).toBeUndefined();
    expect(result.snapshotDate).toBeUndefined();
    expect(result.text).not.toContain('Archived snapshot');
  });
});

describe('formatSize', () => {
  it('formats KB sizes', () => {
    const kb = formatSize(512);
    expect(kb.sizeLabel).toBe('0.5 KB');
    expect(kb.contentLengthKB).toBe(0.5);
  });

  it('formats MB sizes', () => {
    const mb = formatSize(2 * 1024 * 1024);
    expect(mb.sizeLabel).toBe('2 MB');
    // NB: the MB branch stores the MB value in the (misleadingly named)
    // contentLengthKB field — asserting actual behavior, not the name
    expect(mb.contentLengthKB).toBe(2);
  });
});