import type { SearchResult, ProviderConfig } from './base';
import { extractDomain, sanitizeQuery } from './base';
import { searchDuckDuckGo } from './duckduckgo';
import { searchStackOverflow, StackOverflowAPIError, searchStackOverflowAPI } from './stackoverflow';
import { searchNpm } from './npm';
import { searchGitHub } from './github';
import { searchWikipedia } from './wikipedia';
// Re-export all provider functions and types
export type {
  SearchResult,
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