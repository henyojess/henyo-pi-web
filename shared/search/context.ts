import { PROVIDER_MAP, SearchResult } from './providers';
import type { ContextConfig } from '../config';

export interface Provider {
  name: string;
  priority: number;
  fn: (...args: any[]) => Promise<SearchResult[]>;
}

// ─── Compound coding patterns (2+ tokens each) ──────────────────────────────
// Each pattern requires multiple tokens to reduce false positives

export const CODING_SIGNALS: RegExp[] = [
  // Error patterns
  /typeerror[:\s(]/i,
  /syntaxerror[:\s(]/i,
  /traceback\s*\(/i,
  /cannot find module/i,
  // Language constructs
  /import\s+[*\w{]/i,
  /from\s+\w+\s+import/i,
  /const\s+\w+/i,
  /let\s+\w+/i,
  /var\s+\w+/i,
  /async\s+\w*/i,
  /await\s+\w+/i,
  /def\s+\w+/i,
  /class\s+\w+/i,
  /function\s+\w+/i,
  // Package managers
  /npm\s+(install|add|run|test|uninstall|publish|list|info)/i,
  /npm\s+\w+/i,
  /pip\s+(install|uninstall|list|freeze|show)/i,
  /pip\s+\w+/i,
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
  // Testing
  /describe\s*\(/i,
  /it\s*\(/i,
  /test\s*\(/i,
  /expect\s*\(/i,
  /assert\.\w+\s*\(/i,
  // Shell
  /chmod\s|chown\s|sudo\s/i,
  /apt\s+install|yum\s+install|dnf\s+install/i,
  /\$\s*\w+|^\$\s*\w+/i,
  /\$\{\w+\}/i,
  // Docker
  /docker\s+(run|build|ps|compose|container)/i,
  /\w+:\d{4}/i,  // port numbers like :3000, :8080
  // Regex/strings
  /\/[a-z\*]+\/[\s\S]/i,  // regex literal
  /\b(?:true|false|null|undefined)\b/i,
  /console\.log\s*\(/i,
  /print\s*\(/i,
  /\[\s*\w+\s*\]\s*\(/i,  // array construction (compound)
  /\{\s*\w+\s*:\s*\w+\s*\}/i,  // object literal (compound)
  /\w+\.map\s*\(/i,
  /\w+\.filter\s*\(/i,
  /\w+\.reduce\s*\(/i,
  /\w+\.then\s*\(/i,
  /\w+\.catch\s*\(/i,
  /try\s*\{/i,
  /catch\s*\(/i,
  /throw\s+new\s/i,
  // SQL
  /select\s+.*\s+from\s+/i,
  /insert\s+into\s+/i,
  /update\s+\w+\s+set/i,
  /delete\s+from\s+/i,
  // Markdown/code markers
  /```[\w\s]*\n/i,
  /`[^`]+`/i,
];

export function detectContext(query: string): 'coding' | 'general' {
  if (!query.trim()) return 'general';

  let matches = 0;
  for (const pattern of CODING_SIGNALS) {
    if (pattern.test(query)) {
      matches++;
      if (matches >= 2) return 'coding';
    }
  }
  return 'general';
}

export function buildProviderChain(contextName: string, contexts: ContextConfig): Provider[] {
  const context = contexts[contextName] || {};
  const providers: Provider[] = [];

  // Check for SearXNG override (priority 0 = replace default chain)
  if (context.searxng && context.searxng.priority === 0) {
    return [{ name: 'searxng', priority: 0, fn: PROVIDER_MAP.searxng }];
  }

  for (const [name, cfg] of Object.entries(context)) {
    if (cfg.priority !== undefined && PROVIDER_MAP[name]) {
      providers.push({ name, priority: cfg.priority, fn: PROVIDER_MAP[name] });
    }
  }

  providers.sort((a, b) => a.priority - b.priority);
  return providers;
}