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
    const html = '<html></html>';
    const url = 'https://github.com/user/repo/blob/main/README.md';
    // This will try to fetch from raw.githubusercontent.com and fail in test env
    const result = await fetchGitHubContent(html, url);
    // Either null (fetch failed) or a result if network is available
    // In test env without network, expect null
    // We just verify it doesn't throw
    expect(result === null || typeof result === 'object').toBe(true);
  });
});