export interface TruncateResult {
  title: string;
  bodyText: string;
  truncated: boolean;
}

export function smartTruncate(content: string, title: string, headingThreshold: number = 40000): TruncateResult {
  const lines = content.split('\n');
  const headings: [number, string][] = [];
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (headings.length > 0 && result.length > 0) {
        const currentLength = result.join('\n').length;
        if (currentLength >= headingThreshold) {
          return {
            title,
            bodyText: result.join('\n') +
              `\n\n---\n[... content truncated (${content.length} total chars, showing first ${headingThreshold})]\n\nRemaining headings:\n` +
              headings.slice(0, 10).map(([level, text]) => `${'#'.repeat(level)} ${text}`).join('\n') +
              (headings.length > 10 ? `\n... and ${headings.length - 10} more headings` : ''),
            truncated: true,
          };
        }
      }
      headings.push([headingMatch[1].length, headingMatch[2].trim()]);
    }
    result.push(line);
  }

  return { title, bodyText: result.join('\n'), truncated: false };
}