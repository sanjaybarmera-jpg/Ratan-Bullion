import { rbSupabase } from "@/integrations/rb-supabase/client";

export type RateRow = {
  id: string;
  metal_type: string | null;
  mcx_ltp: number | null;
  premium: number | null;
  spread: number | null;
  buy_price: number | null;
  sell_price: number | null;
  high: number | null;
  low: number | null;
  is_available: boolean | null;
  customer_sell_enabled?: boolean | null;
  updated_at: string | null;
  // Contract rollover columns (phase12). Populated by RB Live Engine on
  // every successful pull; frontend reads these directly — never hardcode.
  contract_symbol?: string | null;
  contract_month?: string | null; // "MMM YYYY", e.g. "Aug 2026"
  expiry_date?: string | null;    // ISO YYYY-MM-DD
  // Legacy/defensive fallbacks.
  expiry_month?: string | null;
  expiry?: string | null;
  notes?: string | null;
};

export type MarketSetting = {
  id: string;
  value_text: string | null;
};

export async function fetchAvailableRates(): Promise<RateRow[]> {
  const { data, error } = await rbSupabase
    .from("rates")
    .select("*")
    .order("metal_type", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RateRow[];
}

export function pickRate(rates: RateRow[], aliases: string[]): RateRow | undefined {
  const norm = (s: string | null | undefined) =>
    (s ?? "").toString().trim().toUpperCase().replace(/[\s\-/]+/g, "_");
  const wanted = new Set(aliases.map(norm));
  return rates.find((r) => wanted.has(norm(r.metal_type)));
}

export function rateExpiry(r: RateRow | undefined | null): string | null {
  if (!r) return null;
  const v =
    r.contract_month ??
    r.expiry_month ??
    r.expiry ??
    r.expiry_date ??
    r.notes ??
    null;
  return v ? String(v) : null;
}

/**
 * Database-first pricing. The server `recalculateAllRates()` is the only
 * place that computes prices; the frontend reads buy_price / sell_price /
 * high / low directly from the rates row. This shape is kept for callers.
 */
export type FinalRate = {
  buy: number | null;
  sell: number | null;
  buyHigh: number | null;
  buyLow: number | null;
  sellHigh: number | null;
  sellLow: number | null;
  high: number | null;
  low: number | null;
};

function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

// Database-first pricing engine. ALL price math lives in the server
// `recalculateAllRates()`. The frontend simply reads the priced columns
// from the rates row. This function is a thin pass-through kept only so
// existing call sites compile without churn.
export function computeFinalRate(
  product: RateRow | undefined | null,
  _base?: RateRow | undefined | null,
): FinalRate {
  const buy = n(product?.buy_price);
  const sell = n(product?.sell_price);
  const high = n(product?.high);
  const low = n(product?.low);
  return {
    buy,
    sell,
    high,
    low,
    buyHigh: high,
    buyLow: low,
    sellHigh: high,
    sellLow: low,
  };
}

/**
 * Per-side booking availability for product rows.
 *
 * - `buy`: requires `is_available = true`.
 * - `sell`: requires `is_available = true` AND `customer_sell_enabled = true`.
 *
 * Premium / spread are calculation-only and never gate booking.
 */
export function productBookable(
  product:
    | { is_available?: boolean | null; customer_sell_enabled?: boolean | null }
    | null
    | undefined,
): { buy: boolean; sell: boolean } {
  if (!product) return { buy: false, sell: false };
  const available = product.is_available !== false;
  const sellOn = product.customer_sell_enabled !== false;
  return { buy: available, sell: available && sellOn };
}

const MARKET_KEYS = [
  "usd_gold",
  "usd_silver",
  "usd_inr",
  "ticker_text",
  "contact_phone",
  "dealer_phone",
  "whatsapp_phone",
  "firm2_name",
  "firm2_type",
  "firm2_phone",
  "firm3_name",
  "firm3_type",
  "firm3_phone",
  "firm2_business_type",
  "firm3_business_type",
] as const;

// ---------------------------------------------------------------------------
// Active MCX futures contracts (dynamic, no hardcoding)
//
// RB Live Engine writes the active contract metadata into app_settings:
// currently-active near-month MCX FUTCOM contract into `app_settings` as JSON:
//   id = 'angel_active_gold'   value_text = {"symbolToken","tradingSymbol","expiryISO","resolvedAt"}
//   id = 'angel_active_silver' value_text = { ... }
// It refreshes automatically after each expiry, so the frontend just reads
// these rows and never needs a code change on contract rollover.
// ---------------------------------------------------------------------------

export type ActiveContract = {
  symbolToken?: string;
  tradingSymbol?: string;
  expiryISO?: string; // YYYY-MM-DD
  expiryLabel?: string; // e.g. "Aug 2026"
};

export type ActiveContracts = {
  gold: ActiveContract | null;
  silver: ActiveContract | null;
};

function formatExpiryLabel(iso: string | undefined | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function parseActiveContract(value: string | null | undefined): ActiveContract | null {
  if (!value) return null;
  try {
    const j = JSON.parse(value) as ActiveContract;
    return { ...j, expiryLabel: formatExpiryLabel(j.expiryISO) };
  } catch {
    return null;
  }
}

export async function fetchActiveContracts(): Promise<ActiveContracts> {
  const { data, error } = await rbSupabase
    .from("app_settings")
    .select("id, value_text")
    .in("id", ["angel_active_gold", "angel_active_silver"]);
  if (error) return { gold: null, silver: null };
  const map: Record<string, string | null> = {};
  for (const row of (data ?? []) as MarketSetting[]) map[row.id] = row.value_text;
  return {
    gold: parseActiveContract(map["angel_active_gold"]),
    silver: parseActiveContract(map["angel_active_silver"]),
  };
}

export async function fetchMarketSettings(): Promise<Record<string, string>> {
  const { data, error } = await rbSupabase
    .from("app_settings")
    .select("id, value_text")
    .in("id", MARKET_KEYS as unknown as string[]);
  if (error) return {};
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as MarketSetting[]) {
    if (row.value_text != null) out[row.id] = row.value_text;
  }
  return out;
}

/**
 * Global booking switch. Single source of truth:
 *   app_settings.value (boolean) WHERE id = 'global_booking_enabled'.
 *
 * Fails CLOSED — only an explicit `true` enables booking. NULL, missing
 * row, or any error returns `false` and logs a warning.
 */
export async function fetchGlobalBookingEnabled(): Promise<boolean> {
  try {
    const { data, error } = await rbSupabase
      .from("app_settings")
      .select("value")
      .eq("id", "global_booking_enabled")
      .maybeSingle();
    if (error) {
      console.warn("[fetchGlobalBookingEnabled] read error", error.message);
      return false;
    }
    if (!data) {
      console.warn("[fetchGlobalBookingEnabled] row missing — booking OFF");
      return false;
    }
    const v = (data as { value: boolean | null }).value;
    if (v === null) {
      console.warn("[fetchGlobalBookingEnabled] value is NULL — booking OFF");
      return false;
    }
    return v === true;
  } catch (e) {
    console.error("[fetchGlobalBookingEnabled] threw", e);
    return false;
  }
}