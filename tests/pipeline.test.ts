import { fetchPage } from '../shared/fetch/pipeline';
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
import { isGitHubUrl, fetchGitHubContent } from '../shared/fetch/github';

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

  it('throws on invalid URL', async () => {
    await expect(fetchPage({ url: 'not-a-url', timeout: 5000, noCache: true, config })).rejects.toThrow();
  });

  it('throws on non-existent domain', async () => {
    await expect(fetchPage({ url: 'https://this-domain-does-not-exist-12345.com', timeout: 2000, noCache: true, config })).rejects.toThrow();
  });

  it('fetches HTML and extracts content', async () => {
    mockHtmlFetch();
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: 'This is extracted body text from the HTML page using Defuddle. It has sufficient length to pass the quality check and be considered a valid extraction result by the pipeline.',
      title: 'Test Page',
      author: '', description: '', date: '', lang: '',
    });
    const result = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.resolvedUrl).toContain('example.com');
    expect(result.source).toBe('defuddle');
  });

  it('uses Jina fallback when Defuddle fails', async () => {
    mockHtmlFetch();
    const updates: any[] = [];
    (extractWithDefuddle as any).mockRejectedValue(new Error('defuddle parse error'));
    (fetchWithJina as any).mockResolvedValue({ title: 'Jina Extracted', bodyText: 'Content from Jina Reader.' });
    const result = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config, onUpdate: (u) => updates.push(u) });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.source).toBe('jina');
    expect(updates).toHaveLength(2);
    expect(updates[0].content[0].text).toContain('Defuddle error');
    expect(updates[1].content[0].text).toContain('Jina Reader');
  });

  it('respects jinaEnabled: false config', async () => {
    mockHtmlFetch();
    const noJinaConfig: WebFetchConfig = { ...config, jinaEnabled: false };
    const updates: any[] = [];
    (extractWithDefuddle as any).mockRejectedValue(new Error('defuddle parse error'));
    const result = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config: noJinaConfig, onUpdate: (u) => updates.push(u) });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.source).toBe('raw');
    expect(updates).toHaveLength(2);
    expect(updates[0].content[0].text).toContain('Defuddle error');
    expect(updates[1].content[0].text).toContain('Jina is disabled');
  });

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

  // ─── New tests for previously uncovered paths ──────────────────────────

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

  it('handles text/plain content type response', async () => {
    mockFetch(async () => new Response('Plain text content here', {
      status: 200, headers: { 'Content-Type': 'text/plain' },
    }));
    const result = await fetchPage({ url: 'https://example.com/raw', timeout: 10000, noCache: true, config });
    expect(result.source).toBe('text');
    expect(result.text).toBe('Plain text content here');
  });

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
    // Cloudflare warning + Defuddle error + Jina message = 3 updates
    expect(updates).toHaveLength(3);
    expect(updates[0].content[0].text).toBe('Warning: Site is behind Cloudflare protection.');
  });

  it('handles protected/JS-heavy page with Jina fallback', async () => {
    const updates: any[] = [];
    // Use HTML without Cloudflare markers to avoid double warnings
    mockFetch(async () => new Response(
      '<html><body><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><div id="__nuxt"></div></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    ));
    (fetchWithJina as any).mockResolvedValue({ title: 'Protected Page', bodyText: 'Content from Jina.' });

    const result = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config, onUpdate: (u) => updates.push(u) });
    expect(result.source).toBe('jina');
    expect(updates).toHaveLength(1);
    expect(updates[0].content[0].text).toContain('Detected bot protection');
  });

  it('handles protected page with Jina disabled', async () => {
    const updates: any[] = [];
    const noJinaConfig: WebFetchConfig = { ...config, jinaEnabled: false };
    // Use HTML without Cloudflare markers
    mockFetch(async () => new Response(
      '<html><body><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><div id="__nuxt"></div></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    ));

    const result = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config: noJinaConfig, onUpdate: (u) => updates.push(u) });
    expect(result.source).toBe('raw');
    expect(updates).toHaveLength(2);
    expect(updates[0].content[0].text).toContain('Detected bot protection');
    expect(updates[1].content[0].text).toContain('Jina is disabled');
  });

  it('handles Jina failure on protected page', async () => {
    const updates: any[] = [];
    // Use HTML without Cloudflare markers
    mockFetch(async () => new Response(
      '<html><body><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><div id="__nuxt"></div></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    ));
    (fetchWithJina as any).mockRejectedValue(new Error('Jina timeout'));

    const result = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config, onUpdate: (u) => updates.push(u) });
    expect(result.source).toBe('raw');
    expect(updates).toHaveLength(2);
    expect(updates[1].content[0].text).toContain('Jina Reader error');
  });

  it('falls back to raw when all extraction fails', async () => {
    const updates: any[] = [];
    mockFetch(async () => new Response(mockHtml, { status: 200, headers: { 'Content-Type': 'text/html' } }));
    (extractWithDefuddle as any).mockRejectedValue(new Error('defuddle error'));
    (fetchWithJina as any).mockRejectedValue(new Error('Jina error'));

    const result = await fetchPage({ url: 'https://example.com', timeout: 10000, noCache: true, config, onUpdate: (u) => updates.push(u) });
    expect(result.source).toBe('raw');
    expect(result.text).toContain('Content here');
  });

  it('handles GitHub file URL', async () => {
    (isGitHubUrl as any).mockReturnValue(true);
    (fetchGitHubContent as any).mockResolvedValue({
      title: 'facebook/react — README.md',
      bodyText: 'const x = 42;\nexport default x;',
      source: 'github',
    });
    mockHtmlFetch();
    const result = await fetchPage({ url: 'https://github.com/facebook/react/blob/main/README.md', timeout: 10000, noCache: true, config });
    expect(result.source).toBe('github');
    expect(result.title).toContain('facebook/react');
    expect(result.text).toContain('const x = 42');
  });

  it('handles GitHub file URL when raw fetch fails', async () => {
    (isGitHubUrl as any).mockReturnValue(true);
    (fetchGitHubContent as any).mockResolvedValue(null);
    // Use >150 chars so isDefuddleFailure returns false
    (extractWithDefuddle as any).mockResolvedValue({
      bodyText: 'This is fallback content from Defuddle after the GitHub raw file fetch failed to return content. The pipeline correctly falls back to Defuddle extraction and returns the extracted body text with the proper source indicator set to defuddle for this result object.',
      title: 'Fallback',
      author: '', description: '', date: '', lang: '',
    });
    mockHtmlFetch();
    const result = await fetchPage({ url: 'https://github.com/user/repo/blob/main/file.txt', timeout: 10000, noCache: true, config });
    // Falls back to Defuddle since GitHub raw fetch failed
    expect(result.source).toBe('defuddle');
  });
});