import { extractWithDefuddle, fetchWithJina } from '../shared/fetch/extract';

// Mock JSDOM and Defuddle for controlled testing
vi.mock('jsdom', () => ({
  JSDOM: class MockJSDOM {
    window = { document: { querySelector: () => null } };
  },
}));

vi.mock('defuddle/node', () => ({
  Defuddle: vi.fn(),
}));

import { Defuddle } from 'defuddle/node';

const mockDefuddle = Defuddle as any;

describe('extractWithDefuddle', () => {
  beforeEach(() => {
    mockDefuddle.mockReset();
  });

  it('extracts title and body from HTML', async () => {
    mockDefuddle.mockResolvedValue({
      content: 'Test body content here with sufficient length for quality checks.',
      title: 'Test Page',
      author: '',
      description: '',
      date: '',
      lang: '',
    });
    const result = await extractWithDefuddle('<html><body>test</body></html>', 'https://example.com');
    expect(result.title).toBe('Test Page');
    expect(result.bodyText.length).toBeGreaterThan(0);
  });

  it('handles empty HTML', async () => {
    mockDefuddle.mockResolvedValue({
      content: '',
      title: '',
      author: '',
      description: '',
      date: '',
      lang: '',
    });
    const result = await extractWithDefuddle('<html><body></body></html>', 'https://example.com');
    expect(result.bodyText).toBe('');
    expect(result.title).toBe('');
  });

  it('returns all fields', async () => {
    mockDefuddle.mockResolvedValue({
      content: 'Content',
      title: 'T',
      author: '',
      description: '',
      date: '',
      lang: '',
    });
    const result = await extractWithDefuddle('<html><head><title>T</title></head><body><p>Content</p></body></html>', 'https://example.com');
    expect(result).toHaveProperty('bodyText');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('author');
    expect(result).toHaveProperty('description');
    expect(result).toHaveProperty('date');
    expect(result).toHaveProperty('lang');
  });

  it('uses date value when Defuddle returns one (truthy branch)', async () => {
    mockDefuddle.mockResolvedValue({
      content: 'Test body content here with sufficient length for quality checks.',
      title: 'Test Page',
      author: 'Author Name',
      description: 'Test description',
      date: '2024-01-15',
      lang: 'en',
    });
    const result = await extractWithDefuddle('<html><body>test</body></html>', 'https://example.com');
    expect(result.date).toBe('2024-01-15');
  });

  it('handles undefined date from Defuddle (falsy branch)', async () => {
    mockDefuddle.mockResolvedValue({
      content: 'Test content',
      title: 'Test Title',
      author: undefined,
      description: undefined,
      date: undefined,
      lang: undefined,
    });
    const result = await extractWithDefuddle('<html><body></body></html>', 'https://x.com');
    expect(result.date).toBe('');
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

  it('handles response without Title: line', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('This is content without a title prefix.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    });
    const result = await fetchWithJina('https://example.com', 15000);
    expect(result.title).toBe('');
    expect(result.bodyText).toBe('This is content without a title prefix.');
  });
});