import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { extractHtmlContent, type ExtractionResult } from '../shared/fetch/html-extraction';
import * as extractModule from '../shared/fetch/extract';
import * as githubModule from '../shared/fetch/github';

// Mock extract and github modules
vi.mock('../shared/fetch/extract', () => ({
  extractWithDefuddle: vi.fn(),
  fetchWithJina: vi.fn(),
}));

vi.mock('../shared/fetch/github', () => ({
  isGitHubUrl: vi.fn(),
  fetchGitHubContent: vi.fn(),
}));

// Defuddle stubbed at the module boundary so the REAL extract.ts implementation
// can be loaded via vi.importActual in the "extract.ts real implementation" block
vi.mock('defuddle/node', () => ({ Defuddle: vi.fn() }));

const mockExtract = extractModule as typeof extractModule;
const mockGithub = githubModule as typeof githubModule;

const mockHtml = '<html><head><title>Test</title></head><body><p>Content here with enough text to not be flagged as a defuddle failure and has sufficient length for proper extraction testing purposes.</p></body></html>';

describe('extractHtmlContent — GitHub URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns GitHub content when URL matches', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(true);
    mockGithub.fetchGitHubContent.mockResolvedValue({
      title: 'facebook/react — README.md',
      bodyText: 'const x = 42;\nexport default x;',
      source: 'github',
    });

    const result = await extractHtmlContent(mockHtml, 'https://github.com/facebook/react/blob/main/README.md', { jinaEnabled: true });

    expect(result.source).toBe('github');
    expect(result.title).toContain('facebook/react');
    expect(result.bodyText).toContain('const x = 42');
  });

  it('falls back to Defuddle when GitHub raw fetch fails', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(true);
    mockGithub.fetchGitHubContent.mockResolvedValue(null);
    mockExtract.extractWithDefuddle.mockResolvedValue({
      bodyText: 'This is fallback content from Defuddle after the GitHub raw file fetch failed to return content. The pipeline correctly falls back to Defuddle extraction and returns the extracted body text with the proper source indicator set to defuddle for this result object.',
      title: 'Fallback',
      author: '', description: '', date: '', lang: '',
    });

    const result = await extractHtmlContent(mockHtml, 'https://github.com/user/repo/blob/main/file.txt', { jinaEnabled: true });

    expect(result.source).toBe('defuddle');
  });

  it('falls through to raw when GitHub returns null and Defuddle throws', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(true);
    mockGithub.fetchGitHubContent.mockResolvedValue(null);
    mockExtract.extractWithDefuddle.mockRejectedValue(new Error('defuddle error'));
    mockExtract.fetchWithJina.mockRejectedValue(new Error('jina error'));

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(mockHtml, 'https://github.com/user/repo/blob/main/file.txt', {
      jinaEnabled: true,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('raw');
    expect(result.bodyText).toContain('Content here');
    // No intermediate messages (all suppressed to avoid TUI clutter)
    expect(updates).toHaveLength(0);
  });
});

describe('extractHtmlContent — Defuddle extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts content via Defuddle on normal HTML', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    mockExtract.extractWithDefuddle.mockResolvedValue({
      bodyText: 'This is extracted body text from the HTML page using Defuddle. It has sufficient length to pass the quality check and be considered a valid extraction result by the pipeline.',
      title: 'Test Page',
      author: '', description: '', date: '', lang: '',
    });

    const result = await extractHtmlContent(mockHtml, 'https://example.com', { jinaEnabled: true });

    expect(result.source).toBe('defuddle');
    expect(result.title).toBe('Test Page');
    expect(result.bodyText).toContain('extracted body text');
  });

  it('uses Jina when Defuddle throws an error', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    mockExtract.extractWithDefuddle.mockRejectedValue(new Error('defuddle parse error'));
    mockExtract.fetchWithJina.mockResolvedValue({ title: 'Jina Extracted', bodyText: 'This is content extracted by Jina Reader from the HTML page. It has sufficient length to pass the quality check and be considered a valid extraction result by the pipeline.' });

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(mockHtml, 'https://example.com', {
      jinaEnabled: true,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('jina');
    expect(result.bodyText).toContain('content extracted by Jina Reader');
    // No intermediate messages (suppressed to avoid TUI clutter)
    expect(updates).toHaveLength(0);
  });

  it('uses Jina when Defuddle produces low-quality content', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    mockExtract.extractWithDefuddle.mockResolvedValue({
      bodyText: 'This content is long enough to pass the quality threshold for extraction and be considered a valid result by the pipeline.',
      title: 'https://example.com', // bad title triggers isDefuddleFailure
      author: '', description: '', date: '', lang: '',
    });
    mockExtract.fetchWithJina.mockResolvedValue({ title: 'Jina Title', bodyText: 'This is content extracted by Jina Reader from the HTML page. It has sufficient length to pass the quality check and be considered a valid extraction result by the pipeline.' });

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(mockHtml, 'https://example.com', {
      jinaEnabled: true,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('jina');
    // No intermediate updates — Jina fallback is silent
    expect(updates).toHaveLength(0);
  });

  it('returns raw when Defuddle fails and Jina is disabled', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    mockExtract.extractWithDefuddle.mockRejectedValue(new Error('defuddle error'));

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(mockHtml, 'https://example.com', {
      jinaEnabled: false,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('raw');
    // No intermediate messages (suppressed to avoid TUI clutter)
    expect(updates).toHaveLength(0);
  });

  it('returns raw when all extraction fails', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    mockExtract.extractWithDefuddle.mockRejectedValue(new Error('defuddle error'));
    mockExtract.fetchWithJina.mockRejectedValue(new Error('Jina error'));

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(mockHtml, 'https://example.com', {
      jinaEnabled: true,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('raw');
    // No intermediate messages (all suppressed to avoid TUI clutter)
    expect(updates).toHaveLength(0);
  });
});

describe('extractHtmlContent — JS-heavy pages (Defuddle first)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tries Defuddle first on JS-heavy pages, then Jina', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    const protectedHtml = '<html><body><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><div id="__nuxt"></div></body></html>';
    mockExtract.extractWithDefuddle.mockRejectedValue(new Error('defuddle error'));
    mockExtract.fetchWithJina.mockResolvedValue({ title: 'Protected Page', bodyText: 'This is content extracted by Jina Reader from the HTML page. It has sufficient length to pass the quality check and be considered a valid extraction result by the pipeline.' });

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(protectedHtml, 'https://example.com', {
      jinaEnabled: true,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('jina');
    // No intermediate messages (suppressed to avoid TUI clutter)
    expect(updates).toHaveLength(0);
  });

  it('returns raw on JS-heavy page when both Defuddle and Jina fail', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    const protectedHtml = '<html><body><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><div id="__nuxt"></div></body></html>';
    mockExtract.extractWithDefuddle.mockRejectedValue(new Error('defuddle error'));
    mockExtract.fetchWithJina.mockRejectedValue(new Error('Jina timeout'));

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(protectedHtml, 'https://example.com', {
      jinaEnabled: true,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('raw');
    // No intermediate messages (all suppressed to avoid TUI clutter)
    expect(updates).toHaveLength(0);
  });

  it('returns raw when Defuddle fails and Jina is disabled', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    const protectedHtml = '<html><body><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><div id="__nuxt"></div></body></html>';
    mockExtract.extractWithDefuddle.mockRejectedValue(new Error('defuddle error'));

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(protectedHtml, 'https://example.com', {
      jinaEnabled: false,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('raw');
    // No intermediate messages (suppressed to avoid TUI clutter)
    expect(updates).toHaveLength(0);
  });
});

// Note: Cloudflare warning is emitted by pipeline.ts (isCloudflareChallenge),
// not by extractHtmlContent. Those tests remain in pipeline.test.ts.

// ─── Real extract.ts implementation (Defuddle stubbed at module boundary) ────

describe('extract.ts real implementation (Defuddle stubbed)', () => {
  let realExtract: Awaited<ReturnType<typeof vi.importActual<typeof import('../shared/fetch/extract')>>>;
  let defuddleMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    realExtract = (await vi.importActual<typeof import('../shared/fetch/extract')>('../shared/fetch/extract')) as never;
    defuddleMock = ((await import('defuddle/node')) as Record<string, unknown>).Defuddle as never;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extractWithDefuddle rejects with "Defuddle extraction failed" when Defuddle throws', async () => {
    defuddleMock.mockRejectedValueOnce(new Error('defuddle blew up'));
    await expect(realExtract.extractWithDefuddle(mockHtml, 'https://example.com')).rejects.toThrow('Defuddle extraction failed');
  });

  it('extractWithDefuddle maps and trims Defuddle result fields', async () => {
    defuddleMock.mockResolvedValueOnce({ content: '  real body  ', title: '  T  ', author: '  A  ', description: '  D  ', date: '  2024  ', lang: 'en' });
    const r = await realExtract.extractWithDefuddle(mockHtml, 'https://example.com');
    expect(r).toEqual({ bodyText: 'real body', title: 'T', author: 'A', description: 'D', date: '2024', lang: 'en' });
  });

  it('extractWithDefuddle maps missing result fields to empty strings', async () => {
    defuddleMock.mockResolvedValueOnce({ content: 'content', lang: undefined });
    const r = await realExtract.extractWithDefuddle(mockHtml, 'https://example.com');
    expect(r).toEqual({ bodyText: 'content', title: '', author: '', description: '', date: '', lang: '' });
  });

  it('fetchWithJina parses Title:/--- sections and sends the right headers', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response('Title: Jina Page\n---\nBody text here.', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );
    const r = await realExtract.fetchWithJina('https://example.com', 30, { Authorization: 'Bearer test' });
    expect(r.title).toBe('Jina Page');
    expect(r.bodyText).toBe('Body text here.');
    expect(fetchSpy).toHaveBeenCalledWith('https://r.jina.ai/https://example.com', expect.objectContaining({
      headers: expect.objectContaining({
        'X-Return-Format': 'text',
        'Accept': 'text/plain',
        'Authorization': 'Bearer test',
      }),
    }));
    // let the 30ms abort timer fire so the timeout callback is covered
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  it('fetchWithJina falls back to full text when Title:/--- markers are absent', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => new Response('plain body without markers', { status: 200 }));
    const r = await realExtract.fetchWithJina('https://example.com', 30);
    expect(r.title).toBe('');
    expect(r.bodyText).toBe('plain body without markers');
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  it('fetchWithJina throws on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => new Response('bad gateway', { status: 502 }));
    await expect(realExtract.fetchWithJina('https://example.com', 30)).rejects.toThrow('Jina Reader HTTP 502');
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});

// ─── Jina content acceptability (isJinaContentAcceptable) ────────────────────

describe('extractHtmlContent — Jina content acceptability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Force the Jina fallback path: Defuddle "succeeds" but with a URL title → isDefuddleFailure
  const failDefuddle = () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    mockExtract.extractWithDefuddle.mockResolvedValue({
      bodyText: 'This content is long enough to pass the quality threshold for extraction and be considered a valid result by the pipeline.',
      title: 'https://example.com',
      author: '', description: '', date: '', lang: '',
    });
  };

  it('falls back to raw when Jina body is empty', async () => {
    failDefuddle();
    mockExtract.fetchWithJina.mockResolvedValue({ title: 'Jina Title', bodyText: '' });
    const r = await extractHtmlContent(mockHtml, 'https://example.com', { jinaEnabled: true });
    expect(r.source).toBe('raw');
    expect(r.title).toBe('Jina Title'); // Jina title kept even when body rejected
    expect(r.bodyText).toBe(mockHtml);
  });

  it('falls back to raw when Jina body is under 50 chars', async () => {
    failDefuddle();
    mockExtract.fetchWithJina.mockResolvedValue({ title: 'Jina Title', bodyText: 'short '.repeat(5).trim() }); // 25 chars
    const r = await extractHtmlContent(mockHtml, 'https://example.com', { jinaEnabled: true });
    expect(r.source).toBe('raw');
  });

  it('falls back to raw when Jina body is mostly HTML tags', async () => {
    failDefuddle();
    mockExtract.fetchWithJina.mockResolvedValue({ title: 'Jina Title', bodyText: '<div>'.repeat(40) }); // 160 chars, ~0 text after tag strip
    const r = await extractHtmlContent(mockHtml, 'https://example.com', { jinaEnabled: true });
    expect(r.source).toBe('raw');
  });

  it('accepts Jina body with real text', async () => {
    failDefuddle();
    mockExtract.fetchWithJina.mockResolvedValue({ title: 'Jina T', bodyText: 'This is genuine Jina content with enough substance to be accepted by the quality check.' });
    const r = await extractHtmlContent(mockHtml, 'https://example.com', { jinaEnabled: true });
    expect(r.source).toBe('jina');
    expect(r.title).toBe('Jina T');
  });
});
