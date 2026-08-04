// One-shot helper to look up Angel One MCX symbolTokens.
//
// Why: Angel One's quote API needs numeric symbolTokens, not human names like
// "GOLD25FEB". Tokens change every contract expiry. Run this once after each
// rollover to find the active GOLD / SILVER futures, then store them in
//   app_settings.provider_symbol_gold
//   app_settings.provider_symbol_silver
//
// Usage (after deploy):
//   curl -X POST https://<project>.functions.supabase.co/discover-angel-tokens \
//     -H "Authorization: Bearer <anon-or-service-key>" \
//     -H "Content-Type: application/json" \
//     -d '{"search":"GOLD"}'
//
// Returns the top MCX matches with symbolToken so you can pick the active future.

const SCRIP_MASTER =
  "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

type Scrip = {
  token: string;
  symbol: string;
  name: string;
  expiry: string;
  exch_seg: string;
  instrumenttype: string;
};

let cache: { at: number; data: Scrip[] } | null = null;
async function loadMaster(): Promise<Scrip[]> {
  if (cache && Date.now() - cache.at < 6 * 3600 * 1000) return cache.data;
  const res = await fetch(SCRIP_MASTER);
  const data = (await res.json()) as Scrip[];
  cache = { at: Date.now(), data };
  return data;
}

Deno.serve(async (req) => {
  let body: { search?: string; exchange?: string } = {};
  try {
    body = await req.json();
  } catch { /* allow empty */ }
  const search = (body.search || "GOLD").toUpperCase();
  const exchange = (body.exchange || "MCX").toUpperCase();

  const all = await loadMaster();
  const matches = all
    .filter(
      (s) =>
        s.exch_seg === exchange &&
        (s.instrumenttype || "").startsWith("FUT") &&
        (s.symbol || "").toUpperCase().includes(search),
    )
    .sort((a, b) => a.expiry.localeCompare(b.expiry))
    .slice(0, 25)
    .map((s) => ({
      symbolToken: s.token,
      tradingSymbol: s.symbol,
      name: s.name,
      expiry: s.expiry,
      instrumenttype: s.instrumenttype,
    }));

  return Response.json({ exchange, search, matches });
});