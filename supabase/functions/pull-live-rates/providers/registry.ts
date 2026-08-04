import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { RateProvider } from "./types.ts";
import { createAngelOneProvider } from "./angel-one.ts";

export type ProviderId = "ANGEL_ONE" | "METALS_API" | "CUSTOM_API";

export function getProvider(id: string, supabase: SupabaseClient): RateProvider {
  switch (id) {
    case "ANGEL_ONE":
      return createAngelOneProvider(supabase);
    // Add new providers here. Each must implement RateProvider from ./types.ts.
    // case "METALS_API": return createMetalsApiProvider(supabase);
    // case "CUSTOM_API": return createCustomApiProvider(supabase);
    default:
      throw new Error(`Unknown rate_provider: ${id}. Supported: ANGEL_ONE`);
  }
}