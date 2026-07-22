import { JSDOM } from 'jsdom';
import { Defuddle } from 'defuddle/node';
import { pickRandom, USER_AGENTS } from '../user-agents';

export interface ExtractionResult {
  bodyText: string;
  title: string;
  author: string;
  description: string;
  date: string;
  lang: string;
}

export async function extractWithDefuddle(html: string, url: string): Promise<ExtractionResult> {
  // Suppress Defuddle's console.error/console.log during extraction
  const savedError = console.error;
  const savedLog = console.log;
  console.error = () => {};
  console.log = () => {};
  try {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    const result = await Defuddle(dom.window.document, url, { markdown: true });
    return {
      bodyText: result.content?.trim() || '',
      title: result.title?.trim() || '',
      author: result.author?.trim() || '',
      description: result.description?.trim() || '',
      date: result.date?.trim() || '',
      lang: result.lang || '',
    };
  } catch {
    throw new Error('Defuddle extraction failed');
  } finally {
    console.error = savedError;
    console.log = savedLog;
  }
}

export async function fetchWithJina(
  url: string,
  timeoutMs: number,
  customHeaders?: Record<string, string>,
): Promise<{ title: string; bodyText: string }> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(`https://r.jina.ai/${url}`, {
    signal: controller.signal,
    headers: {
      ...customHeaders,
      'User-Agent': pickRandom(USER_AGENTS),
      'Accept': 'text/plain',
      'X-Return-Format': 'text',
    },
  });

  if (!res.ok) {
    throw new Error(`Jina Reader HTTP ${res.status}`);
  }

  const text = await res.text();
  let title = '';
  let bodyText = text;

  const titleMatch = text.match(/^Title: ([^\n]+)/m);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  const dashIdx = text.indexOf('\n---\n');
  if (dashIdx > 0) {
    bodyText = text.slice(dashIdx + 5);
  }

  return { title, bodyText };
}