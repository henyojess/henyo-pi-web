import { SearchResult, SearchProvider, ProviderDefinition, ProviderFn } from './providers/base';
import { searchDuckDuckGo, extractDomain } from './providers/duckduckgo';
import { searchStackOverflow, StackOverflowAPIError, searchStackOverflowAPI } from './providers/stackoverflow';
import { searchNpm } from './providers/npm';
import { searchGitHub } from './providers/github';
import { searchWikipedia } from './providers/wikipedia';
import { searchJina } from './providers/jina';
import { searchSearXNG } from './providers/searxng';

// Re-export all provider functions and types
export {
  SearchResult,
  SearchProvider,
  ProviderDefinition,
  ProviderFn,
  searchDuckDuckGo,
  searchStackOverflow,
  searchStackOverflowAPI,
  StackOverflowAPIError,
  searchNpm,
  searchGitHub,
  searchWikipedia,
  searchJina,
  searchSearXNG,
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
  searxng: searchSearXNG,
};