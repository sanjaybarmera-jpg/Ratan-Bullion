// Provider abstraction. Adding a new provider = implement RateProvider + register in registry.ts.
// The Edge Function never imports a provider directly.

export type RawQuote = {
  /** Stable internal symbol — must match `app_settings.value_text` for
   *  keys `provider_symbol_gold` / `provider_symbol_silver`. */
  symbol: string;
  ltp: number;
  high: number;
  low: number;
};

export type ProviderConfig = {
  /** Symbol the provider understands for the GOLD base contract. */
  goldSymbol: string;
  /** Symbol the provider understands for the SILVER base contract. */
  silverSymbol: string;
  /** Any provider-specific extras (tokens, exchange codes, etc.). */
  extra: Record<string, string>;
};

export interface RateProvider {
  readonly name: string; // 'ANGEL_ONE' | 'METALS_API' | 'CUSTOM_API'
  fetchQuotes(cfg: ProviderConfig): Promise<{
    gold: RawQuote;
    silver: RawQuote;
  }>;
}