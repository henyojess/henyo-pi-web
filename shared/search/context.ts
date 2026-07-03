import { PROVIDER_MAP, SearchResult } from './providers';
import type { ContextConfig } from '../config';

export interface Provider {
  name: string;
  priority: number;
  fn: (...args: any[]) => Promise<SearchResult[]>;
}

export const CODING_SIGNALS: RegExp[] = [
  /Error:/,
  /TypeError/,
  /SyntaxError/,
  /Traceback/,
  /cannot find module/,
  /import\s+/,
  /const\s+/,
  /async\s+/,
  /await\s+/,
  /def\s+/,
  /class\s+/,
  /npm\s+install|npm\s+run|npm\s+exec|npm\s+publish|npm\s+audit|npm\s+list|npm\s+uninstall|npm\s+update|npm\s+init|npm\s+add|npm\s+config|npm\s+info|npm\s+outdated|npm\s+test|npm\s+start|npm\s+stop|npm\s+restart|npm\s+link|npm\s+unlink|npm\s+publish|npm\s+version|npm\s+pack|npm\s+cache|npm\s+ci|npm\s+dedupe|npm\s+diff|npm\s+doctor|npm\s+edit|npm\s+explore|npm\s+help|npm\s+home|npm\s+info|npm\s+init|npm\s+install|npm\s+link|npm\s+ls|npm\s+logout|npm\s+login|npm\s+org|npm\s+owner|npm\s+pack|npm\s+prefix|npm\s+profile|npm\s+publish|npm\s+query|npm\s+run|npm\s+search|npm\s+star|npm\s+stars|npm\s+start|npm\s+stop|npm\s+team|npm\s+test|npm\s+token|npm\s+uninstall|npm\s+update|npm\s+unpack|npm\s+version|npm\s+view|npm\s+whoami/i,
  /pip\s+install|pip\s+uninstall|pip\s+list|pip\s+freeze|pip\s+show|pip\s+search|pip\s+config|pip\s+install|pip\s+wheel|pip\s+download|pip\s+hash|pip\s+check|pip\s+complete|pip\s+debug|pip\s+help|pip\s+index|pip\s+inspect|pip\s+install|pip\s+list|pip\s+show|pip\s+uninstall|pip\s+upgrade|pip\s+install|pip\s+install|pip\s+install|pip\s+install|pip\s+install|pip\s+install/i,
  /cargo\s+install|cargo\s+build|cargo\s+test|cargo\s+run|cargo\s+check|cargo\s+fmt|cargo\s+clippy|cargo\s+doc|cargo\s+publish|cargo\s+add|cargo\s+update|cargo\s+remove|cargo\s+search|cargo\s+new|cargo\s+init|cargo\s+package|cargo\s+verify|cargo\s+vendor|cargo\s+fix|cargo\s+clean|cargo\s+update|cargo\s+update|cargo\s+update|cargo\s+update|cargo\s+update|cargo\s+update/i,
  /yarn\s+install|yarn\s+add|yarn\s+remove|yarn\s+upgrade|yarn\s+list|yarn\s+run|yarn\s+create|yarn\s+init|yarn\s+publish|yarn\s+login|yarn\s+logout|yarn\s+config|yarn\s+cache|yarn\s+why|yarn\s+why|yarn\s+why|yarn\s+why|yarn\s+why|yarn\s+why|yarn\s+why|yarn\s+why|yarn\s+why|yarn\s+why/i,
  /brew\s+install|brew\s+uninstall|brew\s+list|brew\s+search|brew\s+update|brew\s+upgrade|brew\s+doctor|brew\s+config|brew\s+info|brew\s+install|brew\s+install|brew\s+install|brew\s+install|brew\s+install|brew\s+install/i,
  /Dockerfile/,
  /Makefile/,
  /git\s+commit|git\s+push|git\s+pull|git\s+clone|git\s+fetch|git\s+checkout|git\s+merge|git\s+rebase|git\s+branch|git\s+status|git\s+diff|git\s+log|git\s+add|git\s+rm|git\s+mv|git\s+reset|git\s+stash|git\s+tag|git\s+remote|git\s+init|git\s+config|git\s+bisect|git\s+clean|git\s+gc|git\s+init|git\s+init|git\s+init|git\s+init|git\s+init|git\s+init/i,
  /chmod\s+|chown\s+|sudo\s+|apt\s+install|apt\s+get|yum\s+install|dnf\s+install|pacman\s+-S|apk\s+add|snap\s+install|flatpak\s+install|brew\s+install|pipx\s+install|npx\s+install|npm\s+install|cargo\s+install|go\s+install|rustup\s+install|conda\s+install|poetry\s+install|pipenv\s+install|uv\s+install|bun\s+install|pnpm\s+install|yarn\s+install|npm\s+install|npm\s+install/i,
];

export function detectContext(query: string): 'coding' | 'general' {
  let codingSignals = 0;
  for (const signal of CODING_SIGNALS) {
    if (signal.test(query)) codingSignals++;
  }
  return codingSignals >= 2 ? 'coding' : 'general';
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