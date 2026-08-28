import { smartTruncate } from '../shared/fetch/truncate';

describe('smartTruncate', () => {
  it('returns content unchanged when under threshold', () => {
    const result = smartTruncate('# Heading\nSome content', 'Title', 40000);
    expect(result.truncated).toBe(false);
    expect(result.bodyText).toBe('# Heading\nSome content');
    expect(result.title).toBe('Title');
  });

  it('truncates at heading when threshold exceeded', () => {
    const content = '# H1\ncontent here\n# H2\nmore content\n# H3\nfinal';
    const result = smartTruncate(content, 'Title', 20);
    expect(result.truncated).toBe(true);
    expect(result.bodyText).toContain('H1');
    expect(result.bodyText).toContain('truncated');
    expect(result.bodyText).toContain('H2');
  });

  it('handles content with no headings', () => {
    const result = smartTruncate('Just plain text content here', 'Title', 40000);
    expect(result.truncated).toBe(false);
    expect(result.bodyText).toBe('Just plain text content here');
  });

  it('handles heading as first line (result.length === 0)', () => {
    // This tests the branch where headings.length > 0 but result.length === 0
    const result = smartTruncate('# First Heading\nSome content after heading', 'Title', 40000);
    expect(result.truncated).toBe(false);
    expect(result.bodyText).toContain('First Heading');
  });

  it('handles empty content', () => {
    const result = smartTruncate('', 'Title', 40000);
    expect(result.truncated).toBe(false);
    expect(result.bodyText).toBe('');
  });

  it('preserves title when truncated', () => {
    const content = '# H1\ncontent\n# H2\nmore';
    const result = smartTruncate(content, 'My Title', 10);
    expect(result.title).toBe('My Title');
    expect(result.truncated).toBe(true);
  });

  it('shows remaining headings count when more than 10', () => {
    const headings = Array.from({ length: 15 }, (_, i) => `# Heading ${i}\ncontent ${i}`).join('\n');
    const result = smartTruncate(headings, 'Title', 10);
    expect(result.truncated).toBe(true);
    expect(result.bodyText).toContain('Remaining headings:');
  });

  it('does not show remaining count when 10 or fewer headings', () => {
    const headings = Array.from({ length: 5 }, (_, i) => `# Heading ${i}\ncontent ${i}`).join('\n');
    const result = smartTruncate(headings, 'Title', 10);
    expect(result.truncated).toBe(true);
    expect(result.bodyText).not.toContain('and');
  });

  it('reports the actual shown length, not the threshold', () => {
    // Shown length at the cut point: '# A' + newline + 100 chars = 104
    const content = `# A\n${'x'.repeat(100)}\n# B\nrest`;
    const result = smartTruncate(content, 'Title', 20);
    expect(result.truncated).toBe(true);
    expect(result.bodyText).toContain('showing first 104');
    expect(result.bodyText).toContain(`${content.length} total chars`);
  });

  it('lists headings after the cut, not the ones already shown', () => {
    const content = '# A\nx\n# B\ny\n# C\nz';
    const result = smartTruncate(content, 'Title', 3);
    expect(result.truncated).toBe(true);
    const remaining = result.bodyText.split('Remaining headings:\n')[1];
    expect(remaining).toBe('# B\n# C');
  });

  it('still caps the remaining list at 10 with a count for the rest', () => {
    const parts = ['# A', 'x'];
    for (let i = 1; i <= 14; i++) parts.push(`# H${i}`, 'y');
    const result = smartTruncate(parts.join('\n'), 'Title', 3);
    expect(result.truncated).toBe(true);
    const remaining = result.bodyText.split('Remaining headings:\n')[1];
    expect(remaining).toContain('# H1');
    expect(remaining).toContain('... and 4 more headings');
    expect(remaining).not.toContain('# H11');
  });
});