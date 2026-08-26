import { handleContent } from '../shared/fetch/content-handlers';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a minimal valid PDF in bytes (pattern copied from tests/pdf-extract.test.ts).
 */
function createMinimalPdf(text: string): Uint8Array {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${text.length + 20} >>
stream
BT /F1 12 Tf 50 700 Td (${text}) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
trailer << /Size 6 /Root 1 0 R >>
startxref
0
%%EOF
`;
  return new Uint8Array([...new TextEncoder().encode(pdfContent)]);
}

type Cache = Parameters<typeof handleContent>[0]['cache'];

/** In-memory cache stub shaped like createCache's return value. */
function makeCache() {
  return {
    put: vi.fn(),
    get: vi.fn(() => null),
    evict: vi.fn(),
    clear: vi.fn(),
  } as unknown as Cache;
}

type Options = Parameters<typeof handleContent>[0];

function options(overrides: Partial<Options>): Options {
  return {
    body: '',
    rawBytes: null,
    contentType: 'text/plain',
    resolvedUrl: 'https://example.com/doc',
    cacheKey: 'fetch:https://example.com/doc',
    noCache: false,
    contentThreshold: 10000,
    cache: makeCache(),
    ...overrides,
  };
}

// NOTE: handleContent's binary-fallback path calls a bare `trace(...)` that is
// neither imported nor defined anywhere in the source (latent ReferenceError).
// Stub it on globalThis so that path can be exercised; assertions on the
// surrounding behavior are unaffected.
let traceSpy: ReturnType<typeof vi.fn>;

beforeAll(() => {
  traceSpy = vi.fn();
  (globalThis as Record<string, unknown>).trace = traceSpy;
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).trace;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('handleContent — JSON', () => {
  it('pretty-prints small JSON bodies and caches the result', async () => {
    const cache = makeCache();
    const result = await handleContent(
      options({ body: '{"b":1}', contentType: 'application/json', cache }),
    );
    expect(result).not.toBeNull();
    expect(result!.source).toBe('json');
    expect(result!.text).toBe('{\n  "b": 1\n}');
    expect(result!.oversized).toBeUndefined();
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put.mock.calls[0]![0]).toBe('fetch:https://example.com/doc');
  });

  it('marks oversized JSON with size-exceeded and a cache file path', async () => {
    const cache = makeCache();
    const result = await handleContent(
      options({ body: '{"k":"' + 'a'.repeat(200) + '"}', contentType: 'application/json', contentThreshold: 10, cache }),
    );
    expect(result!.source).toBe('json');
    expect(result!.text).toBe('JSON response exceeded content-threshold limit of 10 characters.');
    expect(result!.oversized).toBe(true);
    expect(result!.errorCategory).toBe('size-exceeded');
    expect(result!.cacheFilePath).toMatch(/\.json$/);
    expect(result!.contentLength).toBeGreaterThan(10);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('does not cache oversized JSON when noCache is set', async () => {
    const cache = makeCache();
    const result = await handleContent(
      options({ body: '{"k":"' + 'a'.repeat(200) + '"}', contentType: 'application/json', contentThreshold: 10, noCache: true, cache }),
    );
    expect(result!.oversized).toBe(true);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('falls through to null when the JSON body fails to parse', async () => {
    const cache = makeCache();
    const result = await handleContent(
      options({ body: 'not valid json', contentType: 'application/json', cache }),
    );
    // catch swallows the parse error; body is not text/plain and not a binary type
    expect(result).toBeNull();
    expect(cache.put).not.toHaveBeenCalled();
  });
});

describe('handleContent — text/plain', () => {
  it('returns source text and caches when noCache is false', async () => {
    const cache = makeCache();
    const result = await handleContent(
      options({ body: 'plain body', contentType: 'text/plain; charset=utf-8', cache }),
    );
    expect(result!.source).toBe('text');
    expect(result!.text).toBe('plain body');
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('does not cache when noCache is true', async () => {
    const cache = makeCache();
    const result = await handleContent(
      options({ body: 'plain body', contentType: 'text/plain', noCache: true, cache }),
    );
    expect(result!.source).toBe('text');
    expect(cache.put).not.toHaveBeenCalled();
  });
});

describe('handleContent — PDF', () => {
  it('extracts PDF from raw bytes when content-type is application/pdf', async () => {
    const cache = makeCache();
    const result = await handleContent(
      options({
        body: 'ignored',
        rawBytes: createMinimalPdf('Hello PDF'),
        contentType: 'application/pdf',
        cache,
      }),
    );
    expect(result!.source).toBe('pdf');
    expect(result!.text).toContain('Hello PDF');
    expect(result!.cached).toBe(false);
    expect(result!.oversized).toBeUndefined();
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('detects PDF via %PDF magic bytes on octet-stream (charCode fallback, rawBytes null)', async () => {
    const cache = makeCache();
    const body = new TextDecoder().decode(createMinimalPdf('Magic Bytes'));
    const result = await handleContent(
      options({ body, rawBytes: null, contentType: 'application/octet-stream', cache }),
    );
    expect(result!.source).toBe('pdf');
    expect(result!.text).toContain('Magic Bytes');
  });

  it('marks oversized PDF extraction with size-exceeded', async () => {
    const cache = makeCache();
    const result = await handleContent(
      options({
        body: 'ignored',
        rawBytes: createMinimalPdf('Hello PDF'),
        contentType: 'application/pdf',
        contentThreshold: 5,
        cache,
      }),
    );
    expect(result!.source).toBe('pdf');
    expect(result!.oversized).toBe(true);
    expect(result!.errorCategory).toBe('size-exceeded');
    expect(result!.cacheFilePath).toMatch(/\.json$/);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });
});

describe('handleContent — binary types', () => {
  it('returns the image message for image/* content types', async () => {
    const cache = makeCache();
    const result = await handleContent(
      options({ body: 'x'.repeat(16), contentType: 'image/png', cache }),
    );
    expect(result!.source).toBe('image');
    expect(result!.text).toBe('This is an image file. Use an image viewer to view it.');
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('returns the zip message for application/zip', async () => {
    const result = await handleContent(
      options({ body: 'x'.repeat(16), contentType: 'application/zip', cache: makeCache() }),
    );
    expect(result!.source).toBe('zip');
    expect(result!.text).toBe('This is a ZIP archive. Content cannot be displayed as text.');
  });

  it('falls back to the generic binary message for unknown binary content', async () => {
    const result = await handleContent(
      options({ body: 'binaryjunk', contentType: 'application/octet-stream', cache: makeCache() }),
    );
    expect(result!.source).toBe('binary');
    expect(result!.text).toBe('This is a binary file. Content cannot be displayed as text.');
  });
});

describe('handleContent — HTML fall-through', () => {
  it('returns null for text/html so the pipeline can extract', async () => {
    const cache = makeCache();
    const result = await handleContent(
      options({ body: '<html><body>hi</body></html>', contentType: 'text/html; charset=utf-8', cache }),
    );
    expect(result).toBeNull();
    expect(cache.put).not.toHaveBeenCalled();
  });
});
