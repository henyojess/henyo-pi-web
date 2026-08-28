export interface TruncateResult {
  title: string;
  bodyText: string;
  truncated: boolean;
}

interface HeadingRef {
  level: number;
  text: string;
  line: number;
}

export function smartTruncate(content: string, title: string, headingThreshold: number = 40000): TruncateResult {
  const lines = content.split('\n');
  // Collect heading positions up front so the truncation marker can list the
  // headings that come AFTER the cut (the content the consumer actually misses).
  const headings: HeadingRef[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      headings.push({ level: m[1]!.length, text: m[2]!.trim(), line: i });
    }
  }
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && result.length > 0) {
      const shown = result.join('\n').length;
      if (shown >= headingThreshold) {
        const firstRemaining = headings.findIndex((h) => h.line === i);
        const remaining = headings.slice(firstRemaining);
        return {
          title,
          bodyText: result.join('\n') +
            `\n\n---\n[... content truncated (${content.length} total chars, showing first ${shown})]\n\nRemaining headings:\n` +
            remaining.slice(0, 10).map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n') +
            (remaining.length > 10 ? `\n... and ${remaining.length - 10} more headings` : ''),
          truncated: true,
        };
      }
    }
    result.push(line);
  }

  return { title, bodyText: result.join('\n'), truncated: false };
}
