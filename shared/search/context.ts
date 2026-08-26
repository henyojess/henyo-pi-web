// ─── Coding context detection ────────────────────────────────────────────────

// ─── Compound coding patterns (2+ tokens each) ──────────────────────────────
// Each pattern requires multiple tokens to reduce false positives

// ─── Strong signals (1 match → coding) ──────────────────────────────────────
// Inherently coding patterns — no false positive risk

export const STRONG_SIGNALS: RegExp[] = [
  // Error patterns
  /typeerror[:\s(]/i,
  /syntaxerror[:\s(]/i,
  /traceback\s*\(/i,
  /cannot find module/i,
  // Imports
  /import\s+[*\w{]/i,
  /from\s+\w+\s+import/i,
  // Package managers
  /npm\s+(install|add|run|test|uninstall|publish|list|info)/i,
  /pip\s+(install|uninstall|list|freeze|show)/i,
  /cargo\s+(build|test|run|check|clippy)/i,
  /yarn\s+(install|add|run|test)/i,
  /brew\s+(install|update|list|search)/i,
  /pnpm\s+(install|add|run)/i,
  /npx\s+\w+/i,
  // Version control
  /git\s+(commit|push|pull|clone|fetch|checkout|merge|rebase|branch|status)/i,
  // Build tools
  /webpack\s|babel\s|eslint\s|prettier\s/i,
  /makefile|dockerfile/i,
  // Shell
  /chmod\s|chown\s|sudo\s/i,
  /apt\s+install|yum\s+install|dnf\s+install/i,
  // Docker
  /docker\s+(run|build|ps|compose|container)/i,
  // Port numbers
  /\w+:\d{4}/i,
  // SQL
  /select\s+.*\s+from\s+/i,
  /insert\s+into\s+/i,
  /update\s+\w+\s+set/i,
  /delete\s+from\s+/i,
  // Markdown/code blocks
  /```[\w\s]*\n/i,
];

// ─── Weak signals (2+ matches → coding) ─────────────────────────────────────
// Could appear in non-coding context — need multiple signals for confidence

export const WEAK_SIGNALS: RegExp[] = [
  // Variable declarations
  /const\s+\w+/i,
  /let\s+\w+/i,
  /var\s+\w+/i,
  // Function defs
  /def\s+\w+/i,
  /class\s+\w+/i,
  /function\s+\w+/i,
  /async\s+\w*/i,
  /await\s+\w+/i,
  // Test patterns
  /describe\s*\(/i,
  /it\s*\(/i,
  /test\s*\(/i,
  /expect\s*\(/i,
  /assert\.\w+\s*\(/i,
  // Array/object methods
  /\w+\.map\s*\(/i,
  /\w+\.filter\s*\(/i,
  /\w+\.reduce\s*\(/i,
  /\w+\.then\s*\(/i,
  /\w+\.catch\s*\(/i,
  // Control flow
  /try\s*\{/i,
  /catch\s*\(/i,
  /throw\s+new\s/i,
  // Print/debug
  /console\.log\s*\(/i,
  /print\s*\(/i,
  // Literal values
  /\b(?:true|false|null|undefined)\b/i,
  // Backticks
  /`[^`]+`/i,
  // Regex
  /\/[a-z\*]+\/[\s\S]/i,
  // Dollar variables
  /\$\s*\w+|^\$\s*\w+/i,
  /\$\{\w+\}/i,
  // Array/object construction
  /\[\s*\w+\s*\]\s*\(/i,
  /\{\s*\w+\s*:\s*\w+\s*\}/i,
];

// ─── Combined (backward compatibility) ──────────────────────────────────────
// Flat array of all signals, same as before

export const CODING_SIGNALS: RegExp[] = [...STRONG_SIGNALS, ...WEAK_SIGNALS];

export function detectContext(query: string): 'coding' | 'general' {
  if (!query.trim()) return 'general';

  // Check strong signals first — 1 match → coding
  let strongMatches = 0;
  for (const pattern of STRONG_SIGNALS) {
    if (pattern.test(query)) strongMatches++;
  }
  if (strongMatches >= 1) return 'coding';

  // Check weak signals — (strong + weak) >= 2 → coding
  let weakMatches = 0;
  for (const pattern of WEAK_SIGNALS) {
    if (pattern.test(query)) weakMatches++;
  }
  if (strongMatches + weakMatches >= 2) return 'coding';

  return 'general';
}