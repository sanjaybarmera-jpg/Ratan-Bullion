// Angel One scrip-master resolver.
//
// Fetches https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json
// and picks the nearest non-expired MCX FUTCOM contract for a given base
// ("GOLD" / "SILVER"). Result is cached for 24h in `app_settings` so cold
// starts don't re-download the multi-MB file, and so we automatically roll
// to the next contract the day after expiry.
//
// No manual token maintenance. No provider_symbol_* rows required.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SCRIP_MASTER_URL =
  "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export type ActiveContract = {
  symbolToken: string;
  tradingSymbol: string;
  expiryISO: string; // YYYY-MM-DD, the contract expiry day (inclusive)
  resolvedAt: string;
};

type Scrip = {
  token: string;
  symbol: string;
  name: string;
  expiry: string; // e.g. "25DEC2025"
  exch_seg: string;
  instrumenttype: string;
};

// In-process cache (per warm Edge instance).
let memoryCache: Record<string, { at: number; contract: ActiveContract }> = {};

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function parseAngelExpiry(s: string): Date | null {
  // Format: DDMMMYYYY  e.g. "05DEC2025"
  if (!s || s.length < 9) return null;
  const d = Number(s.slice(0, 2));
  const mon = MONTHS[s.slice(2, 5).toUpperCase()];
  const y = Number(s.slice(5, 9));
  if (!Number.isFinite(d) || mon == null || !Number.isFinite(y)) return null;
  // Contract is valid through end-of-day on expiry; use 23:59:59 UTC as a safe bound.
  return new Date(Date.UTC(y, mon, d, 23, 59, 59));
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function readCachedFromDb(
  supabase: SupabaseClient,
  base: "GOLD" | "SILVER",
): Promise<{ at: number; contract: ActiveContract } | null> {
  const key = `angel_active_${base.toLowerCase()}`;
  const { data } = await supabase
    .from("app_settings")
    .select("value_text, updated_at")
    .eq("id", key)
    .maybeSingle();
  if (!data?.value_text) return null;
  try {
    const contract = JSON.parse(data.value_text as string) as ActiveContract;
    const at = new Date((data as { updated_at?: string }).updated_at ?? contract.resolvedAt).getTime();
    return { at, contract };
  } catch {
    return null;
  }
}

async function writeCacheToDb(
  supabase: SupabaseClient,
  base: "GOLD" | "SILVER",
  contract: ActiveContract,
) {
  const key = `angel_active_${base.toLowerCase()}`;
  await supabase.from("app_settings").upsert({
    id: key,
    value_text: JSON.stringify(contract),
  });
  // Also mirror the active symbolToken into the generic provider_symbol_*
  // slot so any consumer that reads app_settings sees the current contract
  // without parsing JSON. Keeps rollover fully automatic.
  const symKey = `provider_symbol_${base.toLowerCase()}`;
  await supabase.from("app_settings").upsert({
    id: symKey,
    value_text: contract.symbolToken,
  });
}

// Pull the master once per Edge instance run (still large; called only on miss).
let masterPromise: Promise<Scrip[]> | null = null;
async function loadMaster(): Promise<Scrip[]> {
  if (!masterPromise) {
    masterPromise = (async () => {
      const res = await fetch(SCRIP_MASTER_URL);
      if (!res.ok) throw new Error(`Scrip master fetch failed: ${res.status}`);
      return (await res.json()) as Scrip[];
    })().catch((e) => {
      masterPromise = null; // allow retry on next call
      throw e;
    });
  }
  return masterPromise;
}

function pickNearestActive(all: Scrip[], base: "GOLD" | "SILVER"): ActiveContract {
  const now = Date.now();
  // FUTCOM = commodity futures on MCX. Symbol looks like "GOLD05DEC25FUT" etc.
  // We match by `name` (the underlying), which is the most stable field.
  const candidates = all
    .filter(
      (s) =>
        s.exch_seg === "MCX" &&
        (s.instrumenttype || "").toUpperCase() === "FUTCOM" &&
        (s.name || "").toUpperCase() === base,
    )
    .map((s) => ({ s, exp: parseAngelExpiry(s.expiry) }))
    .filter((x): x is { s: Scrip; exp: Date } => !!x.exp && x.exp.getTime() >= now)
    .sort((a, b) => a.exp.getTime() - b.exp.getTime());

  if (candidates.length === 0) {
    throw new Error(`No active MCX FUTCOM contract found for ${base}`);
  }
  const winner = candidates[0];
  return {
    symbolToken: winner.s.token,
    tradingSymbol: winner.s.symbol,
    expiryISO: toISODate(winner.exp),
    resolvedAt: new Date().toISOString(),
  };
}

function isFresh(entry: { at: number; contract: ActiveContract }): boolean {
  const age = Date.now() - entry.at;
  if (age >= CACHE_TTL_MS) return false;
  // Also invalidate if the contract itself has expired (handles rollover even
  // if the 24h TTL hasn't elapsed).
  const expMs = new Date(`${entry.contract.expiryISO}T23:59:59Z`).getTime();
  if (Date.now() > expMs) return false;
  return true;
}

export async function resolveActiveFut(
  supabase: SupabaseClient,
  base: "GOLD" | "SILVER",
  opts: { force?: boolean } = {},
): Promise<ActiveContract> {
  if (!opts.force) {
    const mem = memoryCache[base];
    if (mem && isFresh(mem)) return mem.contract;

    const db = await readCachedFromDb(supabase, base);
    if (db && isFresh(db)) {
      memoryCache[base] = db;
      return db.contract;
    }
  }

  const master = await loadMaster();
  const contract = pickNearestActive(master, base);
  const entry = { at: Date.now(), contract };
  memoryCache[base] = entry;
  await writeCacheToDb(supabase, base, contract);
  return contract;
}

// Exposed so the provider can force a re-resolve if the broker returns
// "invalid token" / "contract expired" for a cached symbol.
export function clearMemoryCache(base?: "GOLD" | "SILVER") {
  if (base) delete memoryCache[base];
  else memoryCache = {};
}