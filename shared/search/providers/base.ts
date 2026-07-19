// ─── Search Result ────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

// ─── Provider Function Types ─────────────────────────────────────────────────

/** Provider-specific config — shape depends on the provider */
export interface ProviderConfig {
  [key: string]: unknown;
}

/** Provider search function — each provider defines its own signature */
export type ProviderFn = (query: string, config?: ProviderConfig, signal?: AbortSignal) => Promise<SearchResult[]>;

/** A provider with a name and a search function */
export interface ProviderDefinition {
  name: string;
  fn: ProviderFn;
}

/** Provider interface — what every provider must implement */
export interface SearchProvider {
  name: string;
  search: ProviderFn;
}