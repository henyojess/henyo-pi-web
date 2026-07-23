import { chromium } from 'playwright';
import { delay } from '../../user-agents';
import { enqueue } from '../queue';
import { SearchResult, ProviderConfig } from './base';

// ─── SearXNG Provider with Playwright bot protection bypass ──────────────────

/**
 * Search via SearXNG using Playwright to bypass bot protection.
 * Requires a custom URL — public instances are unreliable.
 * 
 * This uses a real browser to solve JavaScript challenges (Cloudflare, Anubis, etc.)
 * that simple fetch() cannot handle.
 */
export async function searchSearXNG(query: string, config?: ProviderConfig, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = config?.url as string | undefined;
  if (!url || !url.trim()) return [];

  return enqueue('searxng', async () => {
    await delay(1000 + Math.random() * 1500);

    if (signal?.aborted) return [];

    try {
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });

      const page = await context.newPage();

      // Listen for navigation to detect bot protection pages
      let blocked = false;
      page.on('request', () => {});
      
      try {
        const searchUrl = `${url}/search?q=${encodeURIComponent(query)}&format=json`;
        
        // Navigate with a timeout
        await page.goto(searchUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        // Wait for the page to stabilize (bot protection checks)
        await page.waitForTimeout(3000);

        // Check if we're still on the search page (not redirected to bot protection)
        const currentUrl = page.url();
        if (currentUrl.includes('/search') && currentUrl.includes('q=')) {
          // Try to get the page content and parse JSON
          const content = await page.content();
          
          // Check if it's a bot protection page
          if (isBotProtectionPage(content)) {
            await browser.close();
            return [];
          }

          // Try to find JSON in the page
          try {
            // Look for JSON data in the page
            const jsonData = await page.evaluate(() => {
              // Try to find JSON-LD or embedded JSON
              const scripts = document.querySelectorAll('script[type="application/json"]');
              for (const script of scripts) {
                try {
                  return JSON.parse(script.textContent || '');
                } catch {}
              }
              return null;
            });

            if (jsonData && jsonData.results) {
              const results = jsonData.results.slice(0, 10).map((r: any) => ({
                title: r.title || 'Untitled',
                url: r.url || '',
                snippet: (r.content || '').substring(0, 300),
                source: 'searxng',
              }));
              await browser.close();
              return results;
            }
          } catch {
            // JSON parsing failed, try alternative approach
          }

          // Fallback: try to extract results from the page HTML
          const results = await extractResultsFromPage(page);
          await browser.close();
          return results;
        }

        // Redirected or blocked — check if we hit bot protection
        const content = await page.content();
        if (isBotProtectionPage(content)) {
          await browser.close();
          return [];
        }

        // Try to get JSON from the redirected page
        try {
          const data = await page.evaluate(() => {
            // Check if the page has search results
            const resultsDiv = document.querySelector('.results');
            if (resultsDiv) {
              return parseResultsFromHTML(resultsDiv.innerHTML);
            }
            return [];
          });
          await browser.close();
          return data;
        } catch {
          await browser.close();
          return [];
        }
      } finally {
        await context.close().catch(() => {});
      }
    } catch (err: any) {
      // Browser launch or navigation failed
      return [];
    }
  });
}

/**
 * Extract search results from a Playwright page.
 */
async function extractResultsFromPage(page: any): Promise<SearchResult[]> {
  try {
    return await page.evaluate(() => {
      const results: SearchResult[] = [];
      
      // Try common SearXNG result selectors
      const selectors = [
        '.result',
        '.result-item',
        '.results .result',
        'article.result',
        '.search-results .result',
      ];

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach((el) => {
            const titleEl = el.querySelector('a') || el.querySelector('.title');
            const snippetEl = el.querySelector('.content') || el.querySelector('.snippet') || el.querySelector('.url');
            
            if (titleEl) {
              results.push({
                title: titleEl.textContent?.trim() || 'Untitled',
                url: (titleEl as HTMLElement).getAttribute('href') || '',
                snippet: snippetEl?.textContent?.trim().substring(0, 300) || '',
                source: 'searxng',
              });
            }
          });
          if (results.length > 0) break;
        }
      }

      return results.slice(0, 10);
    });
  } catch {
    return [];
  }
}

/**
 * Parse results from HTML content.
 */
function parseResultsFromHTML(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  // Simple regex-based extraction
  const titleRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/g;
  const snippetRegex = /<div[^>]*class="[^"]*content[^"]*"[^>]*>([^<]*)/g;
  
  let match;
  while ((match = titleRegex.exec(html)) !== null) {
    results.push({
      title: match[2]?.trim() || 'Untitled',
      url: match[1] || '',
      snippet: '',
      source: 'searxng',
    });
  }
  
  return results.slice(0, 10);
}

/**
 * Detect if an HTML response is a bot protection page.
 */
function isBotProtectionPage(html: string): boolean {
  const lowerHtml = html.toLowerCase();
  
  const indicators = [
    'making sure you\'re not a bot',
    'proof of work',
    'captcha',
    'cloudflare',
    'challenges.cloudflare.com',
    'just a moment',
    'checking your browser',
    'access denied',
    'verify you are human',
    'anubis',
    'within.website',
    'fingerprint',
    'fp=',
    'bot protection',
    'rate limit',
    'too many requests',
  ];

  return indicators.some(indicator => lowerHtml.includes(indicator));
}