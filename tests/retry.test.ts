import { fetchWithRetry } from '../shared/fetch/retry';

describe('fetchWithRetry', () => {
  it('throws on invalid URL', async () => {
    await expect(fetchWithRetry('not-a-url', 5000)).rejects.toThrow();
  });

  it('throws on non-existent domain', async () => {
    await expect(fetchWithRetry('https://this-domain-does-not-exist-12345.com', 2000)).rejects.toThrow();
  });

  it('returns ok response for valid URL', async () => {
    const result = await fetchWithRetry('https://example.com', 10000);
    expect(result.res.ok).toBe(true);
  }, 15000);
});