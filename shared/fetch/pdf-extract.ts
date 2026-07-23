import { extractText } from 'unpdf';
import type { PDFDocument } from 'pdflib';

/**
 * Extract text from a PDF document.
 * Returns markdown with page markers and metadata.
 */
export async function extractPdfContent(pdfBytes: Uint8Array): Promise<{
  text: string;
  title: string;
  author?: string;
  pageCount: number;
  error?: string;
}> {
  try {
    const doc = await extractText(pdfBytes);

    if (!doc || !doc.pages || doc.pages.length === 0) {
      return {
        text: 'PDF contains no extractable text (may be scanned images or password-protected).',
        title: '',
        pageCount: 0,
        error: 'no-text',
      };
    }

    const pageCount = doc.pages.length;
    const metadata = (doc as any).metadata as { title?: string; author?: string } | undefined;

    // Build markdown with page markers
    const pages: string[] = [];
    for (let i = 0; i < doc.pages.length; i++) {
      const pageText = doc.pages[i]?.text || '';
      const cleaned = pageText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      if (cleaned) {
        pages.push(`<!-- Page ${i + 1} -->\n\n${cleaned}`);
      } else {
        pages.push(`<!-- Page ${i + 1} -->\n\n[No extractable text on this page]`);
      }
    }

    const title = metadata?.title || '';
    const author = metadata?.author || undefined;

    return {
      text: pages.join('\n\n---\n\n'),
      title,
      author,
      pageCount,
    };
  } catch (err: any) {
    const errorMessage = err?.message || String(err);

    if (errorMessage.includes('password') || errorMessage.includes('Password')) {
      return {
        text: 'PDF is password-protected. Cannot extract content.',
        title: '',
        pageCount: 0,
        error: 'password-protected',
      };
    }

    if (errorMessage.includes('corrupt') || errorMessage.includes('invalid')) {
      return {
        text: 'PDF file appears to be corrupted or not a valid PDF.',
        title: '',
        pageCount: 0,
        error: 'corrupt',
      };
    }

    return {
      text: `PDF extraction failed: ${errorMessage}`,
      title: '',
      pageCount: 0,
      error: 'extraction-failed',
    };
  }
}