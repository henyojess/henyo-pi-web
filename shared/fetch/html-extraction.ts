import { extractWithDefuddle, fetchWithJina } from './extract';
import { isGitHubUrl, fetchGitHubContent } from './github';
import { isCloudflareChallenge, isProtectedOrJsHeavy, isDefuddleFailure } from './detection';
import type { FetchPageOptions, FetchResult } from './pipeline';

export interface ExtractionResult {
  bodyText: string;
  title: string;
  source: string;
}

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

  // Step 2: Detect protected/JS-heavy pages
  if (!result && !isProtectedOrJsHeavy(html)) {
    // Safe to try Defuddle
    try {
      const extraction = await extractWithDefuddle(html, url);
      result = {
        bodyText: extraction.bodyText,
        title: extraction.title,
        source: 'defuddle',
      };
    } catch (err) {
      onUpdate?.({ content: [{ type: 'text', text: `Defuddle error: ${err.message || err}` }] });
    }

    // If Defuddle produced poor results, try Jina
    if (!result || isDefuddleFailure({ ...result, author: '', description: '', date: '', lang: '' })) {
      if (!jinaEnabled) {
        onUpdate?.({ content: [{ type: 'text', text: 'Warning: Defuddle failed and Jina is disabled.' }] });
        result = { bodyText: html, title: '', source: 'raw' };
      } else {
        onUpdate?.({ content: [{ type: 'text', text: '[Defuddle returned low-quality content, trying Jina Reader...]' }] });
        try {
          const jinaResult = await fetchWithJina(url, jinaTimeout, headers);
          result = { bodyText: jinaResult.bodyText, title: jinaResult.title, source: 'jina' };
        } catch (err) {
          onUpdate?.({ content: [{ type: 'text', text: `Jina Reader error: ${err.message || err}` }] });
          result = { bodyText: html, title: '', source: 'raw' };
        }
      }
    }
  } else if (!result && isProtectedOrJsHeavy(html)) {
    onUpdate?.({ content: [{ type: 'text', text: '[Detected bot protection / JS-heavy page, using Jina Reader directly...]' }] });
    if (!jinaEnabled) {
      onUpdate?.({ content: [{ type: 'text', text: 'Warning: Detected protected page and Jina is disabled.' }] });
      result = { bodyText: html, title: '', source: 'raw' };
    } else {
      try {
        const jinaResult = await fetchWithJina(url, jinaTimeout, headers);
        result = { bodyText: jinaResult.bodyText, title: jinaResult.title, source: 'jina' };
      } catch (err) {
        onUpdate?.({ content: [{ type: 'text', text: `Jina Reader error: ${err.message || err}` }] });
        result = { bodyText: html, title: '', source: 'raw' };
      }
    }
  }

  if (!result) {
    result = { bodyText: html, title: '', source: 'raw' };
  }

  return result;
}