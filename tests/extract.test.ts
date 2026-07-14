import { extractWithDefuddle, fetchWithJina } from '../shared/fetch/extract';

describe('extractWithDefuddle', () => {
  it('extracts title and body from HTML', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Page</title></head>
        <body>
          <h1>Test Heading</h1>
          <p>This is the main content of the page.</p>
          <p>Another paragraph with more text.</p>
        </body>
      </html>
    `;
    const result = await extractWithDefuddle(html, 'https://example.com');
    expect(result.title).toBeTruthy();
    expect(result.bodyText.length).toBeGreaterThan(0);
  });

  it('handles empty HTML', async () => {
    const html = '<html><body></body></html>';
    const result = await extractWithDefuddle(html, 'https://example.com');
    expect(result.bodyText).toBe('');
    expect(result.title).toBe('');
  });

  it('returns all fields', async () => {
    const html = '<html><head><title>T</title></head><body><p>Content</p></body></html>';
    const result = await extractWithDefuddle(html, 'https://example.com');
    expect(result).toHaveProperty('bodyText');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('author');
    expect(result).toHaveProperty('description');
    expect(result).toHaveProperty('date');
    expect(result).toHaveProperty('lang');
  });
});

describe('fetchWithJina', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
      return new Response(
        'Title: Mocked Page\n---\nThis is mocked Jina content for testing.',
        { status: 200, headers: { 'Content-Type': 'text/plain' } },
      );
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts title and body from Jina response', async () => {
    const result = await fetchWithJina('https://example.com', 15000);
    expect(result.title).toBe('Mocked Page');
    expect(result.bodyText).toBe('This is mocked Jina content for testing.');
  });

  it('strips title prefix from body', async () => {
    const result = await fetchWithJina('https://example.com', 15000);
    expect(result.bodyText).not.toContain('Title:');
  });

  it('throws on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Not found', { status: 404 });
    });
    await expect(fetchWithJina('https://example.com', 3000)).rejects.toThrow('HTTP 404');
  });
});