import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    // Defuddle error + trying Jina + Jina error
    expect(updates).toHaveLength(3);
    expect(updates[0].content[0].text).toContain('Defuddle error');
    expect(updates[1].content[0].text).toContain('trying Jina Reader');
    expect(updates[2].content[0].text).toContain('Jina Reader error');
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
    mockExtract.fetchWithJina.mockResolvedValue({ title: 'Jina Extracted', bodyText: 'Content from Jina Reader.' });

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(mockHtml, 'https://example.com', {
      jinaEnabled: true,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('jina');
    expect(result.bodyText).toBe('Content from Jina Reader.');
    // Defuddle error + trying Jina
    expect(updates).toHaveLength(2);
    expect(updates[0].content[0].text).toContain('Defuddle error');
    expect(updates[1].content[0].text).toContain('trying Jina Reader');
  });

  it('uses Jina when Defuddle produces low-quality content', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    mockExtract.extractWithDefuddle.mockResolvedValue({
      bodyText: 'This content is long enough to pass the quality threshold for extraction and be considered a valid result by the pipeline.',
      title: 'https://example.com', // bad title triggers isDefuddleFailure
      author: '', description: '', date: '', lang: '',
    });
    mockExtract.fetchWithJina.mockResolvedValue({ title: 'Jina Title', bodyText: 'Content from Jina.' });

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(mockHtml, 'https://example.com', {
      jinaEnabled: true,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('jina');
    expect(updates).toHaveLength(1);
    expect(updates[0].content[0].text).toContain('low-quality content');
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
    // Defuddle error + Jina disabled warning
    expect(updates).toHaveLength(2);
    expect(updates[0].content[0].text).toContain('Defuddle error');
    expect(updates[1].content[0].text).toContain('Jina is disabled');
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
    // Defuddle error + trying Jina + Jina error
    expect(updates).toHaveLength(3);
    expect(updates[0].content[0].text).toContain('Defuddle error');
    expect(updates[1].content[0].text).toContain('trying Jina Reader');
    expect(updates[2].content[0].text).toContain('Jina Reader error');
  });
});

describe('extractHtmlContent — protected/JS-heavy pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses Jina directly on protected/JS-heavy pages', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    const protectedHtml = '<html><body><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><div id="__nuxt"></div></body></html>';
    mockExtract.fetchWithJina.mockResolvedValue({ title: 'Protected Page', bodyText: 'Content from Jina.' });

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(protectedHtml, 'https://example.com', {
      jinaEnabled: true,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('jina');
    expect(updates).toHaveLength(1);
    expect(updates[0].content[0].text).toContain('Detected bot protection');
  });

  it('returns raw on protected page when Jina is disabled', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    const protectedHtml = '<html><body><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><div id="__nuxt"></div></body></html>';

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(protectedHtml, 'https://example.com', {
      jinaEnabled: false,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('raw');
    expect(updates).toHaveLength(2);
    expect(updates[0].content[0].text).toContain('Detected bot protection');
    expect(updates[1].content[0].text).toContain('Jina is disabled');
  });

  it('falls back to raw when Jina fails on protected page', async () => {
    mockGithub.isGitHubUrl.mockReturnValue(false);
    const protectedHtml = '<html><body><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><script src="a.js"></script><div id="__nuxt"></div></body></html>';
    mockExtract.fetchWithJina.mockRejectedValue(new Error('Jina timeout'));

    const updates: { content: Array<{ type: string; text: string }> }[] = [];
    const result = await extractHtmlContent(protectedHtml, 'https://example.com', {
      jinaEnabled: true,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.source).toBe('raw');
    expect(updates).toHaveLength(2);
    expect(updates[0].content[0].text).toContain('Detected bot protection');
    expect(updates[1].content[0].text).toContain('Jina Reader error');
  });
});

// Note: Cloudflare warning is emitted by pipeline.ts (isCloudflareChallenge),
// not by extractHtmlContent. Those tests remain in pipeline.test.ts.
