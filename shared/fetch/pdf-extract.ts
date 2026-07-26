import { extractText } from 'unpdf';

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

    // unpdf returns text as an array of strings (one per page) in doc.text
    // Also available: doc.totalPages, doc.text (array)
    const textArray = doc?.text as string[] | undefined;
    const totalPages = doc?.totalPages ?? (textArray?.length ?? 0);

    if (!textArray || textArray.length === 0) {
      return {
        text: 'PDF contains no extractable text (may be scanned images or password-protected).',
        title: '',
        pageCount: 0,
        error: 'no-text',
      };
    }

    const metadata = (doc as any).metadata as { title?: string; author?: string } | undefined;

    // Build markdown with page markers from text array
    const pages: string[] = [];
    for (let i = 0; i < textArray.length; i++) {
      const pageText = textArray[i] || '';
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
      pageCount: totalPages,
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