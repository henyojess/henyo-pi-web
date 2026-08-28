// ─── Lazy web tool activation ────────────────────────────────────────────────
//
// The six web tools are registered at load but stay inactive until the
// `web_tools` loader activates them (see index.ts). This module is pure and
// structural — it only needs get/set of the active tool names, so unit tests
// can pass a mock. pi's ExtensionAPI satisfies `ToolActivator` structurally
// (`pi.getActiveTools()` / `pi.setActiveTools()`).

export const WEB_TOOL_NAMES: string[] = [
  'search_ddg',
  'search_wikipedia',
  'search_stackoverflow',
  'search_npm',
  'search_github',
  'henyo_fetch',
];

export interface ToolActivator {
  getActiveTools(): string[];
  setActiveTools(names: string[]): void;
}

/**
 * Remove the web tools from the active set, keeping everything else
 * (built-ins, other extensions' tools). Idempotent — safe to call on every
 * `session_start` reason (startup/reload/new/resume/fork).
 */
export function hideWebTools(pi: ToolActivator): void {
  const active = pi.getActiveTools();
  const kept = active.filter((name) => !WEB_TOOL_NAMES.includes(name));
  if (kept.length !== active.length) {
    pi.setActiveTools(kept);
  }
}

/**
 * Add the web tools to the active set. Purely additive — never removes
 * anything else. No-op (no `setActiveTools` call) when all six are already
 * active.
 */
export function activateWebTools(pi: ToolActivator): { added: string[]; alreadyActive: string[] } {
  const active = pi.getActiveTools();
  const added = WEB_TOOL_NAMES.filter((name) => !active.includes(name));
  const alreadyActive = WEB_TOOL_NAMES.filter((name) => active.includes(name));
  if (added.length > 0) {
    pi.setActiveTools([...new Set([...active, ...added])]);
  }
  return { added, alreadyActive };
}
