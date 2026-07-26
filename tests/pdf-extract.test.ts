import { extractPdfContent } from '../shared/fetch/pdf-extract';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a minimal valid PDF in bytes.
 * This is a real PDF structure (v1.4) with one page containing text.
 */
function createMinimalPdf(text: string): Uint8Array {
  // Minimal PDF with a single text string
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

/** Create a PDF with metadata (title, author). */
function createPdfWithMetadata(text: string, title: string, author?: string): Uint8Array {
  const metadata = `/${title} (Test Title)/Author (Test Author)`;
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R /Metadata << /Length 0 >> >>
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

/** Create invalid/corrupt bytes that start with %PDF but aren't a real PDF. */
function createCorruptPdf(): Uint8Array {
  const corrupt = '%PDF-1.4\nthis is not a real PDF\n%%EOF\n';
  return new Uint8Array([...new TextEncoder().encode(corrupt)]);
}

/** Create bytes that are not a PDF at all. */
function createNonPdf(): Uint8Array {
  const data = '<html><body>Hello world</body></html>';
  return new Uint8Array([...new TextEncoder().encode(data)]);
}

/** Create empty bytes. */
function createEmpty(): Uint8Array {
  return new Uint8Array(0);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('extractPdfContent', () => {
  describe('valid PDFs', () => {
    it('extracts text from a minimal PDF', async () => {
      const result = await extractPdfContent(createMinimalPdf('Hello World'));
      expect(result.text).toContain('Hello World');
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
      expect(result.error).toBeUndefined();
    });

    it('handles metadata fields in result structure', async () => {
      const result = await extractPdfContent(createPdfWithMetadata('Some content', 'My Title', 'Jane Doe'));
      // unpdf may not extract metadata from minimal PDFs, but structure should be present
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('author');
    });

    it('handles multi-line content', async () => {
      const multiLine = 'Line 1\nLine 2\nLine 3';
      const result = await extractPdfContent(createMinimalPdf(multiLine));
      expect(result.text).toContain('Line 1');
      expect(result.text).toContain('Line 2');
      expect(result.text).toContain('Line 3');
    });

    it('handles empty text content', async () => {
      const result = await extractPdfContent(createMinimalPdf(''));
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
      expect(result.text).toContain('Page 1');
    });
  });

  describe('corrupt / invalid PDFs', () => {
    it('detects corrupt PDFs', async () => {
      const result = await extractPdfContent(createCorruptPdf());
      expect(result.error).toBeDefined();
      // unpdf may return various error messages for corrupt PDFs
      expect(result.error).toMatch(/corrupt|invalid|extraction-failed/);
    });

    it('handles non-PDF bytes', async () => {
      const result = await extractPdfContent(createNonPdf());
      expect(result.error).toBeDefined();
    });

    it('handles empty input', async () => {
      const result = await extractPdfContent(createEmpty());
      expect(result.error).toBeDefined();
    });
  });

  describe('output format', () => {
    it('includes page markers in output', async () => {
      const result = await extractPdfContent(createMinimalPdf('Test'));
      expect(result.text).toContain('<!-- Page 1 -->');
    });

    it('returns correct structure', async () => {
      const result = await extractPdfContent(createMinimalPdf('Test'));
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('pageCount');
      expect(result).toHaveProperty('author');
      expect(typeof result.text).toBe('string');
      expect(typeof result.pageCount).toBe('number');
    });
  });
});