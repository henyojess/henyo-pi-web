import { pickRandom, USER_AGENTS } from '../user-agents';

const GITHUB_URL_RE = /^https?:\/\/(?:www\.)?github\.com\//;

export function isGitHubUrl(url: string): boolean {
  return GITHUB_URL_RE.test(url);
}

export async function fetchGitHubContent(html: string, url: string): Promise<{ title: string; bodyText: string; source: string } | null> {
  // Try to parse GitHub file view URL: /owner/repo/blob/ref/path/to/file
  const fileMatch = url.match(/\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (fileMatch) {
    const [, owner, repo, ref, filePath] = fileMatch;

    const apiRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`, {
      headers: { 'User-Agent': pickRandom(USER_AGENTS) },
    });

    if (apiRes.ok) {
      const content = await apiRes.text();
      return {
        title: `${owner}/${repo} — ${filePath}`,
        bodyText: content,
        source: 'github',
      };
    }
  }

  return null;
}