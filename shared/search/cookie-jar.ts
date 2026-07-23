/**
 * Simple cookie jar for SearXNG bot protection bypass.
 * Stores cookies per domain and returns them on subsequent requests.
 */

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
}

/** In-memory cookie store */
const cookieJar = new Map<string, Cookie[]>();

/**
 * Parse Set-Cookie headers and store cookies.
 */
export function storeCookies(url: string, setCookieHeaders: string[]): void {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    for (const header of setCookieHeaders) {
      const parts = header.split(';').map(p => p.trim());
      const [nameValue, ...rest] = parts;
      const [name, value] = nameValue.split('=');

      if (!name || !value) continue;

      let expires: number | undefined;
      for (const part of rest) {
        if (part.toLowerCase().startsWith('expires=')) {
          const expStr = part.split('=')[1];
          const expDate = new Date(expStr);
          if (!isNaN(expDate.getTime())) {
            expires = expDate.getTime();
          }
        }
        if (part.toLowerCase().startsWith('path=')) {
          // Store path for future use
        }
      }

      let cookies = cookieJar.get(domain) || [];
      // Remove expired cookies
      cookies = cookies.filter(c => !c.expires || c.expires > Date.now());
      // Update or add cookie
      const existingIdx = cookies.findIndex(c => c.name === name);
      if (existingIdx >= 0) {
        cookies[existingIdx] = { name, value, domain, expires };
      } else {
        cookies.push({ name, value, domain, expires });
      }
      cookieJar.set(domain, cookies);
    }
  } catch {
    // Silently fail — cookie storage should never break the extension
  }
}

/**
 * Get cookies for a URL.
 */
export function getCookies(url: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const cookies = cookieJar.get(domain) || [];

    for (const cookie of cookies) {
      if (!cookie.expires || cookie.expires > Date.now()) {
        result[cookie.name] = cookie.value;
      }
    }
  } catch {
    // Silently fail
  }
  return result;
}

/**
 * Clear cookies for a specific domain.
 */
export function clearCookies(domain: string): void {
  cookieJar.delete(domain);
}

/**
 * Clear all cookies.
 */
export function clearAllCookies(): void {
  cookieJar.clear();
}