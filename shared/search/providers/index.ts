import { SearchResult, SearchProvider, ProviderDefinition, ProviderFn, ProviderConfig } from './base';
import { searchDuckDuckGo, extractDomain } from './duckduckgo';
import { searchStackOverflow, StackOverflowAPIError, searchStackOverflowAPI } from './stackoverflow';
import { searchNpm } from './npm';
import { searchGitHub } from './github';
import { searchWikipedia } from './wikipedia';
import { searchJina } from './jina';
import { searchSearXNG } from './searxng';

// Re-export all provider functions and types
export {
  SearchResult,
  SearchProvider,
  ProviderDefinition,
  ProviderFn,
  ProviderConfig,
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