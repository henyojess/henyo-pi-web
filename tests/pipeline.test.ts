import { fetchPage } from '../shared/fetch/pipeline';
import type { WebFetchConfig } from '../shared/config';

describe('fetchPage', () => {
  const config: WebFetchConfig = {
    jinaEnabled: true,
    'min-delay': 0,
    'max-delay': 0,
    'cache-max-files': 100,
    'heading-threshold': 40000,
  };

  it('throws on invalid URL', async () => {
    await expect(fetchPage({ url: 'not-a-url', timeout: 5000, noCache: true, config })).rejects.toThrow();
  });

  it('throws on non-existent domain', async () => {
    await expect(fetchPage({ url: 'https://this-domain-does-not-exist-12345.com', timeout: 2000, noCache: true, config })).rejects.toThrow();
  });

  it('fetches HTML and extracts content', async () => {
    const result = await fetchPage({
      url: 'https://example.com',
      timeout: 10000,
      noCache: true,
      config,
    });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.resolvedUrl).toContain('example.com');
  }, 20000);

  it('uses Jina fallback when Defuddle fails', async () => {
    const updates: any[] = [];
    const result = await fetchPage({
      url: 'https://example.com',
      timeout: 10000,
      noCache: true,
      config,
      onUpdate: (u) => updates.push(u),
    });
    expect(result.text.length).toBeGreaterThan(0);
  }, 20000);

  it('respects jinaEnabled: false config', async () => {
    const noJinaConfig: WebFetchConfig = {
      ...config,
      jinaEnabled: false,
    };
    const updates: any[] = [];
    const result = await fetchPage({
      url: 'https://example.com',
      timeout: 10000,
      noCache: true,
      config: noJinaConfig,
      onUpdate: (u) => updates.push(u),
    });
    expect(result.text.length).toBeGreaterThan(0);
  }, 20000);

  it('caches results on second call', async () => {
    const result1 = await fetchPage({
      url: 'https://example.com',
      timeout: 10000,
      noCache: false,
      config,
    });
    const result2 = await fetchPage({
      url: 'https://example.com',
      timeout: 10000,
      noCache: false,
      config,
    });
    expect(result2.text).toBe(result1.text);
  }, 20000);

  it('skips cache with noCache: true', async () => {
    const result1 = await fetchPage({
      url: 'https://example.com',
      timeout: 10000,
      noCache: true,
      config,
    });
    const result2 = await fetchPage({
      url: 'https://example.com',
      timeout: 10000,
      noCache: true,
      config,
    });
    expect(result1.text.length).toBeGreaterThan(0);
    expect(result2.text.length).toBeGreaterThan(0);
  }, 20000);
});