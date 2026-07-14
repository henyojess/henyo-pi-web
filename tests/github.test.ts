import { isGitHubUrl, fetchGitHubContent } from '../shared/fetch/github';

describe('isGitHubUrl', () => {
  it('detects valid GitHub URLs', () => {
    expect(isGitHubUrl('https://github.com/user/repo')).toBe(true);
    expect(isGitHubUrl('http://github.com/user/repo')).toBe(true);
    expect(isGitHubUrl('https://www.github.com/user/repo')).toBe(true);
  });

  it('rejects non-GitHub URLs', () => {
    expect(isGitHubUrl('https://example.com')).toBe(false);
    expect(isGitHubUrl('https://gist.github.com/user')).toBe(false);
    expect(isGitHubUrl('https://github.io/user')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(isGitHubUrl('')).toBe(false);
    expect(isGitHubUrl('github.com')).toBe(false);
  });
});

describe('fetchGitHubContent', () => {
  it('returns null for non-file GitHub URLs', async () => {
    const result = await fetchGitHubContent('<html></html>', 'https://github.com/user/repo');
    expect(result).toBeNull();
  });

  it('returns null for file URL when raw fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Not found', { status: 404 });
    });
    const result = await fetchGitHubContent('<html></html>', 'https://github.com/user/repo/blob/main/README.md');
    expect(result).toBeNull();
  });

  it('returns content for valid GitHub file URL', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('const x = 42;\nexport default x;', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    });
    const result = await fetchGitHubContent(
      '<html></html>',
      'https://github.com/facebook/react/blob/main/README.md',
    );
    expect(result).not.toBeNull();
    expect(result!.title).toBe('facebook/react — README.md');
    expect(result!.bodyText).toBe('const x = 42;\nexport default x;');
    expect(result!.source).toBe('github');
  });

  it('returns null when raw fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Network error');
    });
    const result = await fetchGitHubContent(
      '<html></html>',
      'https://github.com/user/repo/blob/main/file.txt',
    );
    expect(result).toBeNull();
  });
});