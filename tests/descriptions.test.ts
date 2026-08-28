import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Length regression: the six web tool descriptions carry a hard 200-char ceiling
// (plan: "smallest that is still effective" is a review judgment — this test
// enforces the ceiling only). Extraction reuses the baseline regex approach:
// match `name:`/`label:`/`description:` blocks in the index.ts source, strip
// quotes, whitespace, and `+` to get the char count.

const EXPECTED_TOOL_NAMES = [
  'search_ddg',
  'search_wikipedia',
  'search_stackoverflow',
  'search_npm',
  'search_github',
  'henyo_fetch',
] as const;

const MAX_DESCRIPTION_CHARS = 200;

function extractDescriptions(): Map<string, string> {
  const src = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
  const descriptions = new Map<string, string>();
  for (const m of src.matchAll(/name: "(\w+)",\s*label: "[^"]+",\s*description:\s*((?:"[^"]*"\s*\+?\s*)+)/g)) {
    if (!(EXPECTED_TOOL_NAMES as readonly string[]).includes(m[1])) continue;
    descriptions.set(m[1], m[2].replace(/[\s"+]/g, ''));
  }
  return descriptions;
}

describe('web tool description lengths', () => {
  const descriptions = extractDescriptions();

  it('finds exactly the six web tool descriptions', () => {
    expect([...descriptions.keys()].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it.each(EXPECTED_TOOL_NAMES)('%s: description is ≤ 200 chars', (name) => {
    const chars = descriptions.get(name)?.length ?? Infinity;
    expect(chars).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
  });
});
