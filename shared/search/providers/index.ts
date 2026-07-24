import type { SearchResult, SearchProvider, ProviderDefinition, ProviderFn, ProviderConfig } from './base';
import { extractDomain } from './base';
import { searchDuckDuckGo } from './duckduckgo';
import { searchStackOverflow, StackOverflowAPIError, searchStackOverflowAPI } from './stackoverflow';
import { searchNpm } from './npm';
import { searchGitHub } from './github';
import { searchWikipedia } from './wikipedia';
import { searchJina } from './jina';
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
  searchJina,
  extractDomain,
};

// ─── Provider map ────────────────────────────────────────────────────────────

export const PROVIDER_MAP: Record<string, ProviderFn> = {
  duckduckgo: searchDuckDuckGo,
  stackoverflow: searchStackOverflow,
  npm: searchNpm,
  github: searchGitHub,
  wikipedia: searchWikipedia,
  jina: searchJina,
};