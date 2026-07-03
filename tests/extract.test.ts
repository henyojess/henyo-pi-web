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
  it('fetches content via Jina Reader', async () => {
    const result = await fetchWithJina('https://example.com', 15000);
    expect(result.bodyText.length).toBeGreaterThan(0);
  }, 20000);

  it('throws on bad URL', async () => {
    await expect(fetchWithJina('https://this-domain-does-not-exist-xyz.invalid', 3000)).rejects.toThrow();
  }, 10000);
});