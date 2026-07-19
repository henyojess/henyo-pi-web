import { delay } from '../../user-agents';

// ─── CAPTCHA / rate-limit detection ──────────────────────────────────────────

const CAPTCHA_KEYWORDS = [
  'access denied', 'verify you are human', 'captcha', 'blocked', 'safety check',
];

export function isCaptchaResponse(body: string): boolean {
  const lower = body.toLowerCase();
  return CAPTCHA_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Retry wrapper ───────────────────────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  providerName?: string,
  maxRetries = 2,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        const backoffMs = 2000 * Math.pow(2, attempt);
        await delay(backoffMs);
      }
    }
  }
  throw lastError;
}

// ─── Domain extraction ───────────────────────────────────────────────────────

export function extractDomain(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return undefined;
  }
}

// ─── Search Result ────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

// ─── Provider Function Types ─────────────────────────────────────────────────

/** Provider-specific config — shape depends on the provider */
export interface ProviderConfig {
  [key: string]: unknown;
}

/** Provider search function — each provider defines its own signature */
export type ProviderFn = (query: string, config?: ProviderConfig, signal?: AbortSignal) => Promise<SearchResult[]>;

/** A provider with a name and a search function */
export interface ProviderDefinition {
  name: string;
  fn: ProviderFn;
}

/** Provider interface — what every provider must implement */
export interface SearchProvider {
  name: string;
  search: ProviderFn;
}