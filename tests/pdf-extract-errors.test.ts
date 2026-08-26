import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractText } from 'unpdf';
import { extractPdfContent } from '../shared/fetch/pdf-extract';

// Mocked unpdf — the real-unpdf happy path stays in tests/pdf-extract.test.ts
vi.mock('unpdf', () => ({ extractText: vi.fn() }));

const mockExtractText = extractText as unknown as ReturnType<typeof vi.fn>;

const dummyBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF header bytes

describe('extractPdfContent — error branches (mocked unpdf)', () => {
  beforeEach(() => {
    mockExtractText.mockReset();
  });

  it('maps "password" errors to error: password-protected', async () => {
    mockExtractText.mockRejectedValue(new Error('password required'));
    const result = await extractPdfContent(dummyBytes);
    expect(result.error).toBe('password-protected');
    expect(result.text).toBe('PDF is password-protected. Cannot extract content.');
    expect(result.title).toBe('');
    expect(result.pageCount).toBe(0);
  });

  it('maps capitalized "Password" errors to error: password-protected', async () => {
    mockExtractText.mockRejectedValue(new Error('Wrong Password supplied'));
    const result = await extractPdfContent(dummyBytes);
    expect(result.error).toBe('password-protected');
  });

  it('maps "corrupt" errors to error: corrupt', async () => {
    mockExtractText.mockRejectedValue(new Error('corrupt or invalid PDF'));
    const result = await extractPdfContent(dummyBytes);
    expect(result.error).toBe('corrupt');
    expect(result.text).toBe('PDF file appears to be corrupted or not a valid PDF.');
    expect(result.pageCount).toBe(0);
  });

  it('maps "invalid" (non-corrupt wording) errors to error: corrupt', async () => {
    mockExtractText.mockRejectedValue(new Error('xref table invalid'));
    const result = await extractPdfContent(dummyBytes);
    expect(result.error).toBe('corrupt');
  });

  it('maps other errors to error: extraction-failed with the message included', async () => {
    mockExtractText.mockRejectedValue(new Error('something unexpected happened'));
    const result = await extractPdfContent(dummyBytes);
    expect(result.error).toBe('extraction-failed');
    expect(result.text).toBe('PDF extraction failed: something unexpected happened');
  });

  it('maps errors without a message property to extraction-failed via String(err)', async () => {
    mockExtractText.mockRejectedValue('plain string error');
    const result = await extractPdfContent(dummyBytes);
    expect(result.error).toBe('extraction-failed');
    expect(result.text).toBe('PDF extraction failed: plain string error');
  });

  it('returns error: no-text when extractText resolves with an empty text array', async () => {
    mockExtractText.mockResolvedValue({ text: [], totalPages: 0 });
    const result = await extractPdfContent(dummyBytes);
    expect(result.error).toBe('no-text');
    expect(result.text).toBe('PDF contains no extractable text (may be scanned images or password-protected).');
    expect(result.pageCount).toBe(0);
  });

  it('returns error: no-text when extractText resolves without a text property', async () => {
    mockExtractText.mockResolvedValue({});
    const result = await extractPdfContent(dummyBytes);
    expect(result.error).toBe('no-text');
    expect(result.pageCount).toBe(0);
  });

  it('returns error: no-text when extractText resolves null', async () => {
    mockExtractText.mockResolvedValue(null);
    const result = await extractPdfContent(dummyBytes);
    expect(result.error).toBe('no-text');
  });
});
