import { fetchWithRetry } from '../shared/fetch/retry';

// Mock delay to be instant
vi.mock('../shared/user-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/user-agents')>();
  return {
    ...actual,
    pickRandom: (arr: string[]) => arr[0],
    delay: () => Promise.resolve(),
  };
});

describe('fetchWithRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws on invalid URL', async () => {
    await expect(fetchWithRetry('not-a-url', 5000)).rejects.toThrow();
  });

  it('throws on non-existent domain', async () => {
    await expect(fetchWithRetry('https://this-domain-does-not-exist-12345.com', 2000)).rejects.toThrow();
  });

  it('returns ok response for valid URL', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('<html><body>OK</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const result = await fetchWithRetry('https://example.com', 10000);
    expect(result.res.ok).toBe(true);
  });

  it('throws on HTTP error (non-retryable)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Not Found', { status: 404 });
    });
    await expect(fetchWithRetry('https://example.com/notfound', 5000)).rejects.toThrow('HTTP 404');
  });

  it('retries on 503 and succeeds', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Service Unavailable', { status: 503 });
      }
      return new Response('<html><body>OK</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const result = await fetchWithRetry('https://example.com', 10000);
    expect(callCount).toBe(2);
    expect(result.res.ok).toBe(true);
  });

  it('throws after max retries on 502', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Bad Gateway', { status: 502 });
    });
    await expect(fetchWithRetry('https://example.com', 5000)).rejects.toThrow('Failed after 3 retries');
  });
});