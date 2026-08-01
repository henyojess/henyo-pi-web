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
import { FetchResultUI, buildErrorFetchHeader, buildExpandedFetchContent, buildCollapsedFetchHeader } from "./shared/fetch/ui.js";
import type { FetchErrorCategory } from "./shared/fetch/pipeline.js";
const LOG = "/tmp/henyo-fetch-debug.log";
function log(...args: any[]) {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`);
}

import { loadConfig, validateConfig } from "./shared/config";
import { createCache } from "./shared/cache";
import { sanitizeQuery } from "./shared/search/providers/base";
import type { SearchResult } from "./shared/search/providers/base";
import { searchDuckDuckGo } from "./shared/search/providers/duckduckgo";
import { searchWikipedia } from "./shared/search/providers/wikipedia";
import { searchStackOverflow } from "./shared/search/providers/stackoverflow";
import { searchNpm } from "./shared/search/providers/npm";
import { searchGitHub } from "./shared/search/providers/github";
import { fetchPage } from "./shared/fetch/pipeline";
import { formatResults, rankResults, diversifyByDomain } from "./shared/format";

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

  // --- Skill registration ---
  pi.on('resources_discover', async (_event, _ctx) => {
    return {
      skillPaths: [
        extPath('skills', 'deep-research'),
      ],
    };
  });

  // ─── Helper: common cache dir ──────────────────────────────────────────────
  function getSearchCacheDir(toolName: string): string {
    return getCacheDir(toolName);
  }

  // ─── Helper: shared search execute logic ───────────────────────────────────
  export function createSearchExecute(
    providerFn: (query: string, config?: any, signal?: AbortSignal) => Promise<SearchResult[]>,
    toolName: string,
    needsSanitization: boolean,
  ) {
    return async (_toolCallId: string, params: { query: string; max?: number; noCache?: boolean }, signal: AbortSignal | undefined, _onUpdate: any, _ctx: any) => {
      const { query, max = 10, noCache = false } = params;

      const cache = createCache<SearchResult[]>(
        getSearchCacheDir(toolName),
        1800,
      );

      const cacheKey = `search:${toolName}:${query}`;
      if (!noCache) {
        const cached = cache.get(cacheKey);
        if (cached) {
          return {
            content: [{ type: "text", text: `[cache hit — ${cached.length} results]\n\n${formatResults(cached)}` }],
            details: { cached: true, count: cached.length, providers: [{ name: toolName, status: 'ok' as const }] },
          };
        }
      }

      // Sanitize or pass raw query depending on provider
      const searchQuery = needsSanitization ? sanitizeQuery(query) : query;

      const providerResults: Array<{ name: string; status: 'ok' | 'error' }> = [];
      let results: SearchResult[];
      try {
        results = await providerFn(searchQuery, undefined, signal);
        providerResults.push({ name: toolName, status: 'ok' });
      } catch (err: any) {
        providerResults.push({ name: toolName, status: 'error' });
        return {
          content: [{ type: "text", text: "No results found." }],
          details: { count: 0, providers: providerResults },
        };
      }

      // Apply BM25 ranking and domain diversification before slicing
      const ranked = rankResults(query, results);
      const diversified = diversifyByDomain(ranked, 2);

      // Check for abort — return partial results if signal was triggered
      if (signal?.aborted) {
        return {
          content: [{ type: "text", text: diversified.length > 0 ? formatResults(diversified.slice(0, max)) : "Search cancelled" }],
          details: { count: diversified.length, aborted: true, providers: providerResults },
        };
      }

      if (!noCache) {
        cache.put(cacheKey, results);
      }

      if (diversified.length === 0) {
        return {
          content: [{ type: "text", text: "No results found." }],
          details: { count: 0, providers: providerResults },
        };
      }

      const sliced = diversified.slice(0, max);
      return {
        content: [{ type: "text", text: formatResults(sliced) }],
        details: { count: sliced.length, providers: providerResults },
      };
    };
  }

  // ─── search_ddg tool ──────────────────────────────────────────────────────
  pi.registerTool({
    name: "search_ddg",
    label: "Search DuckDuckGo",
    description:
      "General web search via DuckDuckGo. Query with any topic, question, or phrase. " +
      "Use for news, articles, broad topics, and as a fallback when no specialized provider fits.",
    promptSnippet:
      "Search DuckDuckGo for general web results. Use for news, articles, and broad topics.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query (any topic or phrase)" }),
      max: Type.Optional(Type.Integer({
        default: 10, minimum: 1, maximum: 50,
        description: "Max results to return",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    execute: createSearchExecute(searchDuckDuckGo, "search_ddg", false),
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
      "Search Wikipedia for encyclopedia knowledge. Query with short topic names (e.g. 'React', 'Kubernetes', 'Machine Learning'), " +
      "not full questions. Use for definitions, concepts, history, and factual background.",
    promptSnippet:
      "Search Wikipedia for encyclopedia knowledge. Use short topic names, not full questions.",
    parameters: Type.Object({
      query: Type.String({ description: "Short topic name (e.g. 'React', 'Kubernetes')" }),
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
    execute: createSearchExecute(searchWikipedia, "search_wikipedia", false),
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
      "Search Stack Overflow for programming Q&A. Query with error messages, code patterns, or specific programming problems " +
      "(e.g. 'TypeError Cannot read properties of undefined'). Use for debugging, syntax, and API usage questions.",
    promptSnippet:
      "Search Stack Overflow for programming Q&A. Use error messages and code patterns.",
    parameters: Type.Object({
      query: Type.String({ description: "Error message or code pattern" }),
      max: Type.Optional(Type.Integer({
        default: 10, minimum: 1, maximum: 50,
        description: "Max results to return",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    // StackOverflow provider reads its own API key from config directly (no param passing)
    execute: createSearchExecute(searchStackOverflow, "search_stackoverflow", false),
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
      "Search the npm registry for JavaScript packages. Query with package names or functionality descriptions " +
      "(e.g. 'state management', 'date formatting'). Use when looking for libraries or dependencies.",
    promptSnippet:
      "Search the npm registry for JavaScript packages. Use package names or functionality descriptions.",
    parameters: Type.Object({
      query: Type.String({ description: "Package name or functionality description" }),
      max: Type.Optional(Type.Integer({
        default: 10, minimum: 1, maximum: 50,
        description: "Max results to return",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    execute: createSearchExecute(searchNpm, "search_npm", true),
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
      "Search GitHub for repositories and source code. Query with repo names, library names, or code patterns " +
      "(e.g. 'react-router', 'fastapi'). Use when looking for source code, issues, or documentation.",
    promptSnippet:
      "Search GitHub for repositories and source code. Use repo names, library names, or code patterns.",
    parameters: Type.Object({
      query: Type.String({ description: "Repo name or code pattern" }),
      max: Type.Optional(Type.Integer({
        default: 10, minimum: 1, maximum: 50,
        description: "Max results to return",
      })),
      noCache: Type.Optional(Type.Boolean({
        default: false,
        description: "Skip cache",
      })),
    }),
    execute: createSearchExecute(searchGitHub, "search_github", false),
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
    promptSnippet:
      "Extract clean content from a URL. Defuddle + Jina fallback. Handles protected/JS-heavy pages. Caching enabled.",
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
                cacheFilePath: result.cacheFilePath,
                readStrategy: "prefer grep or read(offset/limit) to extract specific sections",
                warning: "reading the full file may bloat context",
              }, null, 2),
            }],
            details: {
              url: result.resolvedUrl,
              title: result.title,
              source: result.source,
              cached: wasCached,
              cacheFilePath: result.cacheFilePath,
              contentLength: result.contentLength,
              contentLengthKB: result.contentLengthKB,
              sizeLabel: result.sizeLabel,
              oversized: true,
              truncated: result.truncated,
            },
          };
        }

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
          message.includes('403') || message.includes('forbidden') ? 'forbidden' :
          message.includes('500') || message.includes('502') || message.includes('503') ? 'server-error' :
          message.includes('fetch failed') || message.includes('network') || message.includes('failed after') ? 'network' :
          'unknown';
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

      if (expanded) {
        const expandedText = buildExpandedFetchContent(ui, theme, keyHint);
        if (expandedText) {
          return new Text(expandedText, 0, 0);
        }
      }

      const header = buildCollapsedFetchHeader(ui, theme);
      return new Text(`${header}\n(${theme.fg("muted", "press " + keyHint("app.tools.expand", "to expand"))})`, 0, 0);
    },
  });

}