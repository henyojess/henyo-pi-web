import type { SearchResult, SearchProvider, ProviderDefinition, ProviderFn, ProviderConfig } from './base';
import { extractDomain, sanitizeQuery } from './base';
import { searchDuckDuckGo } from './duckduckgo';
import { searchStackOverflow, StackOverflowAPIError, searchStackOverflowAPI } from './stackoverflow';
import { searchNpm } from './npm';
import { searchGitHub } from './github';
import { searchWikipedia } from './wikipedia';
// Re-export all provider functions and types
export type {
  SearchResult,
  SearchProvider,
  ProviderDefinition,
  ProviderFn,
  ProviderConfig,
};
export {
  searchDuckDuckGo,
  searchStackOverflow,
  searchStackOverflowAPI,
  StackOverflowAPIError,
  searchNpm,
  searchGitHub,
  searchWikipedia,
  extractDomain,
  sanitizeQuery,
};

// ─── Provider map ────────────────────────────────────────────────────────────

export const PROVIDER_MAP: Record<string, ProviderFn> = {
  duckduckgo: searchDuckDuckGo,
  stackoverflow: searchStackOverflow,
  npm: searchNpm,
  github: searchGitHub,
  wikipedia: searchWikipedia,
};