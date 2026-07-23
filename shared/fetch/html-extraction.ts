import { extractWithDefuddle, fetchWithJina } from './extract';
import { isGitHubUrl, fetchGitHubContent } from './github';
import { isCloudflareChallenge, isDefuddleFailure } from './detection';
import type { FetchPageOptions, FetchResult } from './pipeline';

export interface ExtractionResult {
  bodyText: string;
  title: string;
  source: string;
}

/**
 * Check if Jina content quality is acceptable.
 * Returns true if the content has enough substance to be useful.
 */
function isJinaContentAcceptable(bodyText: string): boolean {
  if (!bodyText) return false;
  const trimmed = bodyText.trim();
  // Need at least 50 chars of actual content
  if (trimmed.length < 50) return false;
  // Should not be just HTML tags or empty
  const textOnly = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (textOnly.length < 30) return false;
  return true;
}

/**
 * Extract content from HTML using Defuddle first, then Jina as fallback.
 */
export async function extractHtmlContent(
  html: string,
  url: string,
  options: {
    jinaEnabled: boolean;
    jinaTimeout?: number;
    headers?: Record<string, string>;
    onUpdate?: FetchPageOptions['onUpdate'];
  },
): Promise<ExtractionResult> {
  const { jinaEnabled, jinaTimeout = 30000, headers, onUpdate } = options;
  let result: ExtractionResult | null = null;

  // Step 1: Check for GitHub URLs
  if (isGitHubUrl(url)) {
    const githubResult = await fetchGitHubContent(html, url);
    if (githubResult) {
      result = githubResult;
    }
  }

  // Step 2: Try Defuddle first (always, regardless of JS-heavy detection)
  if (!result) {
    let defuddleFailed = false;
    try {
      const extraction = await extractWithDefuddle(html, url);
      result = {
        bodyText: extraction.bodyText,
        title: extraction.title,
        source: 'defuddle',
      };
    } catch (err) {
      defuddleFailed = true;
    }

    // Check if Defuddle produced acceptable results
    if (!result || isDefuddleFailure({ ...result, author: '', description: '', date: '', lang: '' })) {
      if (!jinaEnabled) {
        result = { bodyText: html, title: '', source: 'raw' };
      } else {
        try {
          const jinaResult = await fetchWithJina(url, jinaTimeout, headers);
          if (isJinaContentAcceptable(jinaResult.bodyText)) {
            result = { bodyText: jinaResult.bodyText, title: jinaResult.title, source: 'jina' };
          } else {
            // Jina content is poor quality, fall back to raw HTML
            result = { bodyText: html, title: jinaResult.title, source: 'raw' };
          }
        } catch (err) {
          // Jina failed — fall back to raw, no message to avoid TUI clutter
          result = { bodyText: html, title: '', source: 'raw' };
        }
      }
    }
  }

  if (!result) {
    result = { bodyText: html, title: '', source: 'raw' };
  }

  return result;
}