import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import fs from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function extPath(...segments: string[]) {
  return join(__dirname, ...segments);
}
import { FetchResultUI, buildErrorFetchHeader, buildCollapsedFetchHeader } from "./shared/fetch/ui.js";
import type { FetchErrorCategory } from "./shared/fetch/pipeline.js";
const LOG = "/tmp/henyo-fetch-debug.log";
function log(...args: any[]) {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`);
}

import { loadConfig, validateConfig } from "./shared/config";
import { rateLimitStore } from "./shared/rate-limit";
import { createCache } from "./shared/cache";
import { searchDuckDuckGo } from "./shared/search/providers/duckduckgo";
import { searchWikipedia } from "./shared/search/providers/wikipedia";
import { searchStackOverflow } from "./shared/search/providers/stackoverflow";
import { searchNpm } from "./shared/search/providers/npm";
import { searchGitHub } from "./shared/search/providers/github";
import { fetchPage } from "./shared/fetch/pipeline";
import { createSearchExecute } from "./shared/search/execute";
import { traceEnd } from "./shared/search/trace";
import { WEB_TOOL_NAMES, hideWebTools, activateWebTools } from "./shared/web-tools";

function getCacheDir(subdir: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!process.env.HOME && process.env.USERPROFILE) {
    console.warn('[henyo-search] HOME is undefined, using USERPROFILE for cache path');
  }
  return `${home}/.pi/tools-cache/${subdir}`;
}

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  validateConfig(config);
  rateLimitStore.clearExpired(); // session start: drop expired cooldown entries

  // --- Skill registration ---
  pi.on('resources_discover', async (_event, _ctx) => {
    return {
      skillPaths: [
        extPath('skills', 'deep-research'),
        extPath('skills', 'web-tools'),
      ],
    };
  });

  // Lazy activation: the six web tools stay registered but inactive until
  // the `web_tools` loader (or /web-tools) enables them for the session.
  pi.on('session_start', () => {
    hideWebTools(pi);
  });

  pi.registerCommand("web-tools", {
    description: "Force-activate the web research tools",
    handler: async (_args, ctx) => {
      const { added, alreadyActive } = activateWebTools(pi);
      ctx.ui.notify(
        added.length > 0
          ? `Web tools enabled: ${added.join(", ")}`
          : `Web tools already active: ${alreadyActive.join(", ")}`,
      );
    },
  });

  // ─── Helper: common cache dir ──────────────────────────────────────────────
  function getSearchCacheDir(toolName: string): string {
    return getCacheDir(toolName);
  }

  // ─── search_ddg tool ──────────────────────────────────────────────────────
  pi.registerTool({
    name: "search_ddg",
    label: "Search DuckDuckGo",
    description:
      "General web search via DuckDuckGo. Use for: news, articles, broad topics, general queries. Fallback when " +
      "no specialized tool fits. Don't use for: specific programming errors (→ search_stackoverflow).",
    parameters: Type.Object({
      query: Type.String({ description: "Focused topic, question, or phrase — keep it short; long multi-clause queries return weaker results" }),
      max: Type.Optional(Type.Integer({
        default: 10, minimum: 1, maximum: 50,
        description: "Max results to return",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    execute: createSearchExecute(searchDuckDuckGo, "search_ddg", false, config['henyo-search']),
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", "search_ddg ") + theme.fg("muted", `"${args.query}"`), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) {
        return new Text(theme.fg("muted", "Processing..."), 0, 0);
      }
      const details = (result.details as any) || {};
      const count = details.count ?? 0;
      let header = theme.fg("muted", `ddg(${count})`);
      if (expanded) {
        const textContent = result.content?.find(c => c.type === 'text');
        if (textContent?.text) {
          header = `${textContent.text}\n\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to collapse"))})`;
        }
      } else {
        header = `${header}\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to expand"))})`;
      }
      return new Text(header, 0, 0);
    },
  });

  // ─── search_wikipedia tool ────────────────────────────────────────────────
  pi.registerTool({
    name: "search_wikipedia",
    label: "Search Wikipedia",
    description:
      "Encyclopedia knowledge via Wikipedia. Use for: definitions, concepts, history. Query: short topic names " +
      "like 'React (software)' or 'Kubernetes', not full questions. Don't use for: code errors (→ search_stackoverflow).",
    parameters: Type.Object({
      query: Type.String({ description: "Short topic name (e.g. 'React (software)', 'Kubernetes') — not full questions" }),
      max: Type.Optional(Type.Integer({
        default: 10, minimum: 1, maximum: 50,
        description: "Max results to return",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    // Wikipedia sanitizes internally (strips HTML, limits extract length), so outer sanitization is redundant
    execute: createSearchExecute(searchWikipedia, "search_wikipedia", false, config['henyo-search']),
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", "search_wikipedia ") + theme.fg("muted", `"${args.query}"`), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) {
        return new Text(theme.fg("muted", "Processing..."), 0, 0);
      }
      const details = (result.details as any) || {};
      const count = details.count ?? 0;
      let header = theme.fg("muted", `wikipedia(${count})`);
      if (expanded) {
        const textContent = result.content?.find(c => c.type === 'text');
        if (textContent?.text) {
          header = `${textContent.text}\n\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to collapse"))})`;
        }
      } else {
        header = `${header}\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to expand"))})`;
      }
      return new Text(header, 0, 0);
    },
  });

  // ─── search_stackoverflow tool ────────────────────────────────────────────
  pi.registerTool({
    name: "search_stackoverflow",
    label: "Search Stack Overflow",
    description:
      "Programming Q&A via Stack Overflow. Use for: error messages, code patterns, debugging, syntax, API usage. " +
      "Include the full error message and code pattern. Don't use for: package lookups (→ search_npm).",
    parameters: Type.Object({
      query: Type.String({ description: "Full error message and code pattern — the specific problem, not a general question" }),
      max: Type.Optional(Type.Integer({
        default: 10, minimum: 1, maximum: 50,
        description: "Max results to return",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    execute: createSearchExecute(searchStackOverflow, "search_stackoverflow", false, config['henyo-search']),
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", "search_stackoverflow ") + theme.fg("muted", `"${args.query}"`), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) {
        return new Text(theme.fg("muted", "Processing..."), 0, 0);
      }
      const details = (result.details as any) || {};
      const count = details.count ?? 0;
      let header = theme.fg("muted", `stackoverflow(${count})`);
      if (expanded) {
        const textContent = result.content?.find(c => c.type === 'text');
        if (textContent?.text) {
          header = `${textContent.text}\n\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to collapse"))})`;
        }
      } else {
        header = `${header}\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to expand"))})`;
      }
      return new Text(header, 0, 0);
    },
  });

  // ─── search_npm tool ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "search_npm",
    label: "Search npm",
    description:
      "JavaScript package registry search via npm. Use for: package names, JS library functionality, " +
      "dependency lookups. Don't use for: non-JS packages (pip, crates) (→ search_ddg).",
    parameters: Type.Object({
      query: Type.String({ description: "Package name or functionality description — short and specific (e.g. 'react', 'state machine')" }),
      max: Type.Optional(Type.Integer({
        default: 10, minimum: 1, maximum: 50,
        description: "Max results to return",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    execute: createSearchExecute(searchNpm, "search_npm", true, config['henyo-search']),
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", "search_npm ") + theme.fg("muted", `"${args.query}"`), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) {
        return new Text(theme.fg("muted", "Processing..."), 0, 0);
      }
      const details = (result.details as any) || {};
      const count = details.count ?? 0;
      let header = theme.fg("muted", `npm(${count})`);
      if (expanded) {
        const textContent = result.content?.find(c => c.type === 'text');
        if (textContent?.text) {
          header = `${textContent.text}\n\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to collapse"))})`;
        }
      } else {
        header = `${header}\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to expand"))})`;
      }
      return new Text(header, 0, 0);
    },
  });

  // ─── search_github tool ──────────────────────────────────────────────────
  pi.registerTool({
    name: "search_github",
    label: "Search GitHub",
    description:
      "Repository and issue search via GitHub. Use for: repo names, library names, issues (open or closed). " +
      "Query: short names, not full sentences. Don't use for: package docs (→ search_npm); Q&A (→ search_stackoverflow).",
    parameters: Type.Object({
      query: Type.String({ description: "Repository name, library name, or issue keywords — short, focused terms" }),
      max: Type.Optional(Type.Integer({
        default: 10, minimum: 1, maximum: 50,
        description: "Max results to return",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    execute: createSearchExecute(searchGitHub, "search_github", false, config['henyo-search']),
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", "search_github ") + theme.fg("muted", `"${args.query}"`), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) {
        return new Text(theme.fg("muted", "Processing..."), 0, 0);
      }
      const details = (result.details as any) || {};
      const count = details.count ?? 0;
      let header = theme.fg("muted", `github(${count})`);
      if (expanded) {
        const textContent = result.content?.find(c => c.type === 'text');
        if (textContent?.text) {
          header = `${textContent.text}\n\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to collapse"))})`;
        }
      } else {
        header = `${header}\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to expand"))})`;
      }
      return new Text(header, 0, 0);
    },
  });

  // --- henyo_fetch tool ---
  pi.registerTool({
    name: "henyo_fetch",
    label: "Henyo Fetch",
    description:
      "Extract clean readable content from any URL. Uses Defuddle locally with Jina Reader fallback. " +
      "Handles Cloudflare protection, SPAs, GitHub raw files. Cached 1 hour.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
      timeout: Type.Optional(Type.Integer({
        default: 15000, minimum: 1000, maximum: 60000,
        description: "Request timeout in milliseconds",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
      headers: Type.Optional(Type.Record(Type.String(), Type.String(), {
        description: "Custom HTTP headers (e.g., { 'Authorization': 'Bearer token' })",
      })),
    }),
    async execute(toolCallId, params, signal, onUpdate, _ctx) {
      const { url, timeout = 15000, noCache = false, headers } = params;
      log('execute: toolCallId=' + toolCallId + ' url=' + url);
      // Wire trace config (mirror of execute.ts) — henyo-search.trace gates fetch too
      (globalThis as any).__henyoTraceConfig = config['henyo-search']?.trace ?? false;
      const startTime = Date.now();

      // 100ms delay so TUI can properly update
      await new Promise(r => setTimeout(r, 100));

      try {
        const result = await fetchPage({
          url,
          timeout,
          noCache,
          config: config["henyo-fetch"],
          signal,
          onUpdate: undefined,
          headers,
        });

        // Handle oversized content — return metadata + read strategy
        if (result.oversized) {
          const wasCached = !noCache && result.cached;
          traceEnd('henyo-fetch', url, startTime, { status: wasCached ? 'cache-hit' : 'oversized', resultCount: result.contentLength ?? 0 });
          // The cache file is the model's only window into oversized content. Only
          // advertise the path when it actually holds this result: noCache skips the
          // write entirely, and a cached entry's file may have been evicted.
          const filePath = !noCache && result.cacheFilePath && fs.existsSync(result.cacheFilePath)
            ? result.cacheFilePath
            : undefined;
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                oversized: true,
                cached: wasCached,
                sizeLabel: result.sizeLabel,
                url: result.resolvedUrl,
                title: result.title,
                source: result.source,
                ...(filePath
                  ? {
                      cacheFilePath: filePath,
                      readStrategy: "prefer grep or read(offset/limit) to extract specific sections",
                      warning: "reading the full file may bloat context",
                    }
                  : { note: "content exceeded the inline limit and was not persisted to disk — re-run without noCache to cache it" }),
              }, null, 2),
            }],
            details: {
              url: result.resolvedUrl,
              title: result.title,
              source: result.source,
              cached: wasCached,
              cacheFilePath: filePath,
              contentLength: result.contentLength,
              contentLengthKB: result.contentLengthKB,
              sizeLabel: result.sizeLabel,
              oversized: true,
              truncated: result.truncated,
            },
          };
        }

        traceEnd('henyo-fetch', url, startTime, {
          status: result.cached ? 'cache-hit' : (result.source === 'size-exceeded' ? 'size-exceeded' : 'ok'),
          resultCount: result.text.length,
        });
        return {
          content: [{ type: "text", text: result.text }],
          details: {
            url: result.resolvedUrl,
            title: result.title,
            source: result.source,
            truncated: result.truncated,
            contentLengthKB: result.contentLengthKB,
            sizeLabel: result.sizeLabel,
            oversized: result.oversized,
            cached: result.cached,
            cacheFilePath: result.cacheFilePath,
          },
        };
      } catch (err: any) {
        const message = err.message || String(err);
        const errorCategory: FetchErrorCategory = message.includes('ssrf') ? 'ssrf' :
          message.includes('invalid URL') ? 'invalid-url' :
          message.includes('timeout') ? 'timeout' :
          message.includes('404') ? 'not-found' :
          message.includes('HTTP 400') ? 'bad-request' :
          message.includes('403') || message.includes('forbidden') ? 'forbidden' :
          message.includes('500') || message.includes('502') || message.includes('503') ? 'server-error' :
          message.includes('fetch failed') || message.includes('network') || message.includes('failed after') ? 'network' :
          'unknown';
        traceEnd('henyo-fetch', url, startTime, { status: 'error', resultCount: 0, error: errorCategory });
        return {
          content: [{ type: "text", text: message }],
          details: {
            url: params.url,
            error: message,
            errorCategory,
          },
        };
      }
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", "henyo_fetch ") + `"${args.url}"`, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) {
        return new Text(theme.fg("muted", "Processing..."), 0, 0);
      }

      const details = (result.details as any) || {};
      const ui: FetchResultUI = {
        url: details.url ?? context?.args?.url ?? '',
        title: details.title ?? '',
        source: details.source ?? 'unknown',
        sizeLabel: details.sizeLabel,
        contentLengthKB: details.contentLengthKB,
        truncated: details.truncated,
        oversized: details.oversized,
        cached: details.cached,
        cacheFilePath: details.cacheFilePath,
        error: (result as any).error,
        errorCategory: details.errorCategory,
        content: result.content?.[0]?.type === 'text' ? result.content[0].text : '',
      };

      // Check for error
      if (ui.error || details.errorCategory) {
        const header = buildErrorFetchHeader(ui, theme);
        if (expanded) {
          return new Text(`${header}\n\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to collapse"))})`, 0, 0);
        }
        return new Text(`${header}\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to expand"))})`, 0, 0);
      }

      const header = buildCollapsedFetchHeader(ui, theme);
      if (ui.cacheFilePath) {
        return new Text(`${header}\n\n  Cache: ${ui.cacheFilePath}`, 0, 0);
      }
      return new Text(header, 0, 0);
    },
  });

  // ─── web_tools loader (lazy activation for the six web tools) ──────────────
  pi.registerTool({
    name: "web_tools",
    label: "Web Tools",
    description:
      `Enables the web research tools (${WEB_TOOL_NAMES.join(", ")}). Call this first for any ` +
      "task requiring web search or fetching a URL.",
    promptSnippet: "Enable the web search/fetch tools before any web research task",
    parameters: Type.Object({}),
    async execute() {
      const { added, alreadyActive } = activateWebTools(pi);
      return {
        content: [{
          type: "text",
          text: added.length > 0
            ? `Web tools enabled: ${added.join(", ")}`
            : `Web tools already active: ${alreadyActive.join(", ")}`,
        }],
        details: { added, alreadyActive },
      };
    },
  });

}