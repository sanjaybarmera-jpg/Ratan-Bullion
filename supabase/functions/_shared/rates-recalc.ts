// Deno-compatible mirror of src/lib/rb-rates-recalc.server.ts.
// Logic MUST stay identical to the Node version.
//
// Formula:
//   BUY_PRICE  = base.mcx_ltp + premium
//   SELL_PRICE = BUY_PRICE - spread
//   HIGH       = base.high  + premium     (BUY HIGH)
//   LOW        = base.low   + premium     (BUY LOW — never sell low)
//
// Writes: buy_price, sell_price, high, low, updated_at.
// Never touches: premium, spread, is_available, customer_sell_enabled, mcx_ltp.

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export async function recalculateAllRates(
  client: SupabaseLike,
): Promise<{ updated: number }> {
  const { data: rows, error } = await client
    .from("rates")
    .select("id, metal_type, mcx_ltp, high, low, premium, spread");
  if (error) throw new Error(`recalculateAllRates: read failed: ${error.message}`);
  if (!rows || rows.length === 0) return { updated: 0 };

  type Row = {
    id: string;
    metal_type: string | null;
    mcx_ltp: number | null;
    high: number | null;
    low: number | null;
    premium: number | null;
    spread: number | null;
  };

  const all = rows as Row[];
  const gold = all.find((r) => r.id === "gold");
  const silver = all.find((r) => r.id === "silver");

  const baseFor = (metal: string | null): Row | undefined => {
    if (!metal) return undefined;
    const u = metal.toUpperCase();
    if (u.startsWith("GOLD")) return gold;
    if (u.startsWith("SILVER")) return silver;
    return undefined;
  };

  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const nowIso = new Date().toISOString();
  let updated = 0;

  for (const row of all) {
    let buy_price: number | null;
    let sell_price: number | null;
    let high: number | null;
    let low: number | null;

    if (row.id === "gold" || row.id === "silver") {
      const ltp = num(row.mcx_ltp);
      buy_price = ltp;
      sell_price = ltp;
      high = num(row.high);
      low = num(row.low);
    } else {
      if (!row.metal_type) continue;
      const base = baseFor(row.metal_type);
      if (!base) continue;

      const baseLtp = num(base.mcx_ltp);
      const baseHigh = num(base.high);
      const baseLow = num(base.low);
      const prem = num(row.premium) ?? 0;
      const sprd = num(row.spread) ?? 0;

      buy_price = baseLtp != null ? baseLtp + prem : null;
      sell_price = buy_price != null ? buy_price - sprd : null;
      high = baseHigh != null ? baseHigh + prem : null;
      low = baseLow != null ? baseLow + prem : null; // BUY LOW
    }

    const { error: upErr } = await client
      .from("rates")
      .update(
        row.id === "gold" || row.id === "silver"
          ? { buy_price, sell_price, high, low, updated_at: nowIso }
          : {
              mcx_ltp: num(baseFor(row.metal_type)?.mcx_ltp),
              buy_price,
              sell_price,
              high,
              low,
              updated_at: nowIso,
            },
      )
      .eq("id", row.id);
    if (upErr) {
      console.error("[recalculateAllRates] update failed", { id: row.id, err: upErr.message });
      continue;
    }
    updated += 1;
  }

  return { updated };
}