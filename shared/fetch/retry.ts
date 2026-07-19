import { pickRandom, delay, USER_AGENTS, ACCEPT_LANGUAGES } from '../user-agents';

const RETRY_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

export async function fetchWithRetry(
  url: string,
  timeoutMs: number,
  customHeaders?: Record<string, string>,
): Promise<{ res: Response; url: string }> {
  let targetUrl = url;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  for (let i = 0; i <= MAX_RETRIES; i++) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          ...customHeaders,
          'User-Agent': pickRandom(USER_AGENTS),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': pickRandom(ACCEPT_LANGUAGES),
          'Accept-Encoding': 'gzip, deflate, br',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'follow',
      });

      if (res.ok) return { res, url: res.url };

      if (!RETRY_CODES.has(res.status)) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const retryAfter = res.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, i) * 1000 + Math.random() * 500;

      if (i < MAX_RETRIES) {
        await delay(waitMs);
      }
    } catch (err: any) {
      if (i < MAX_RETRIES && (err.name === 'AbortError' || err.code)) {
        await delay(Math.pow(2, i) * 1000 + Math.random() * 500);
      } else {
        throw new Error(err.message || String(err));
      }
    }
  }
  throw new Error(`Failed after ${MAX_RETRIES} retries`);
}