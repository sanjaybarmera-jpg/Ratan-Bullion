// pull-live-rates  —  production Edge Function
//
// Triggered every 1 minute by pg_cron. Internally loops to achieve a
// ~30s refresh cadence (configurable via app_settings.pull_interval_seconds).
//
// Reads provider config from `app_settings`:
//   rate_provider              = 'ANGEL_ONE' (default)
//   provider_symbol_gold       = Angel symbolToken for the active GOLD future
//   provider_symbol_silver     = Angel symbolToken for the active SILVER future
//   provider_exchange          = 'MCX'        (default)
//   pull_interval_seconds      = '30'         (default)
//   pull_loops_per_invocation  = '2'          (default — 2*30s = 60s)
//
// Writes:
//   - rates rows id='gold' / id='silver': mcx_ltp, high, low, updated_at
//     (product rows recalc via existing triggers — see phase4_rates_autocalc.sql)
//   - rates_health row id='pull-live-rates': last_successful_fetch, last_error, etc.
//
// Safety:
//   - Never writes nulls or non-positive values (last good rates stay).
//   - One run NEVER throws to the caller; errors are recorded in rates_health.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getProvider } from "./providers/registry.ts";
import { recalculateAllRates } from "../_shared/rates-recalc.ts";
import { resolveActiveFut } from "./providers/angel-scrip-master.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PULL_RATES_CRON_SECRET") ?? "";

async function readSettings(supabase: ReturnType<typeof createClient>) {
  const ids = [
    "rate_provider",
    "provider_exchange",
    "pull_interval_seconds",
    "pull_loops_per_invocation",
  ];
  const { data } = await supabase.from("app_settings").select("id, value_text").in("id", ids);
  const m: Record<string, string> = {};
  for (const r of (data ?? []) as Array<{ id: string; value_text: string | null }>) {
    if (r.value_text != null) m[r.id] = r.value_text;
  }
  return {
    providerId: m.rate_provider || "ANGEL_ONE",
    exchange: m.provider_exchange || "MCX",
    intervalSec: Math.max(5, Number(m.pull_interval_seconds || "30")),
    loops: Math.max(1, Number(m.pull_loops_per_invocation || "2")),
  };
}

// Ensure the Edge Function configuration matches the current performance
// target (10s cadence × 6 pulls per invocation = full 60s coverage between
// pg_cron ticks). Idempotent — writes only when the stored value differs.
async function ensurePerformanceSettings(
  supabase: ReturnType<typeof createClient>,
  current: { intervalSec: number; loops: number },
) {
  const desired = { intervalSec: 10, loops: 6 };
  const rows: Array<{ id: string; value_text: string }> = [];
  if (current.intervalSec !== desired.intervalSec) {
    rows.push({ id: "pull_interval_seconds", value_text: String(desired.intervalSec) });
  }
  if (current.loops !== desired.loops) {
    rows.push({ id: "pull_loops_per_invocation", value_text: String(desired.loops) });
  }
  if (!rows.length) return current;
  const { error } = await supabase.from("app_settings").upsert(rows);
  if (error) {
    console.error("[pull-live-rates] settings sync failed:", error.message);
    return current;
  }
  return { ...current, ...desired };
}

async function recordHealth(
  supabase: ReturnType<typeof createClient>,
  patch: Record<string, unknown>,
) {
  await supabase.from("rates_health").upsert({ id: "pull-live-rates", ...patch });
}

async function writeBaseRate(
  supabase: ReturnType<typeof createClient>,
  baseId: "gold" | "silver",
  q: { ltp: number; high: number; low: number },
) {
  if (!Number.isFinite(q.ltp) || q.ltp <= 0) {
    throw new Error(`Refusing to write invalid ltp for ${baseId}: ${q.ltp}`);
  }
  const { error } = await supabase
    .from("rates")
    .update({
      mcx_ltp: q.ltp,
      high: q.high,
      low: q.low,
      updated_at: new Date().toISOString(),
    })
    .eq("id", baseId);
  if (error) throw new Error(`rates update failed (${baseId}): ${error.message}`);
}

// Format the Angel expiry ISO (YYYY-MM-DD) as "MMM YYYY", e.g. "Aug 2026".
function formatContractMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

// Stamp the currently-active MCX contract onto EVERY related rate row so the
// frontend can render contract_symbol / contract_month / expiry_date directly
// from the rates table with zero hardcoding and automatic monthly rollover.
async function stampContracts(
  supabase: ReturnType<typeof createClient>,
  gold: { symbol: string; expiryISO: string },
  silver: { symbol: string; expiryISO: string },
) {
  const goldPayload = {
    contract_symbol: gold.symbol,
    contract_month: formatContractMonth(gold.expiryISO),
    expiry_date: gold.expiryISO,
  };
  const silverPayload = {
    contract_symbol: silver.symbol,
    contract_month: formatContractMonth(silver.expiryISO),
    expiry_date: silver.expiryISO,
  };

  // Match by metal_type prefix so ALL variants (gold, gold_999, gold_9930,
  // gold_999_rtgs, silver_98, silver_999_rtgs, ...) always inherit the
  // current active contract. Base rows id='gold'/'silver' have metal_type
  // set to GOLD*/SILVER* as well, so a single filter covers everything.
  const { error: gErr } = await supabase
    .from("rates")
    .update(goldPayload)
    .or("metal_type.ilike.GOLD%,id.ilike.gold%");
  if (gErr) console.error("[pull-live-rates] stamp gold contracts failed:", gErr.message);

  const { error: sErr } = await supabase
    .from("rates")
    .update(silverPayload)
    .or("metal_type.ilike.SILVER%,id.ilike.silver%");
  if (sErr) console.error("[pull-live-rates] stamp silver contracts failed:", sErr.message);
}

async function pullOnce(supabase: ReturnType<typeof createClient>) {
  const cfg = await readSettings(supabase);
  // (aggregateMinuteCandles is defined below and invoked after recalc.)
  const provider = getProvider(cfg.providerId, supabase);
  const quotes = await provider.fetchQuotes({
    // Symbols are auto-discovered by providers that support it (Angel One).
    // Other providers may read them from their own config; the abstraction
    // intentionally allows blank values here.
    goldSymbol: "",
    silverSymbol: "",
    extra: { exchange: cfg.exchange },
  });
  await writeBaseRate(supabase, "gold", quotes.gold);
  await writeBaseRate(supabase, "silver", quotes.silver);
  // Always re-read the current active contracts (DB-cached, auto-rolls on
  // expiry). Never hardcoded. Mirrors symbolToken into provider_symbol_*
  // and stamps every gold/silver rate row with contract metadata.
  try {
    const [g, s] = await Promise.all([
      resolveActiveFut(supabase, "GOLD"),
      resolveActiveFut(supabase, "SILVER"),
    ]);
    await stampContracts(
      supabase,
      { symbol: g.tradingSymbol, expiryISO: g.expiryISO },
      { symbol: s.tradingSymbol, expiryISO: s.expiryISO },
    );
  } catch (e) {
    console.error("[pull-live-rates] contract stamp failed:", e instanceof Error ? e.message : String(e));
  }
  try {
    await supabase.from("rates_history").insert([
      {
        metal_type: "GOLD_FUTURE",
        ltp: quotes.gold.ltp,
        open: quotes.gold.ltp,
        high: quotes.gold.high,
        low: quotes.gold.low,
        close: quotes.gold.ltp,
        provider: provider.name,
      },
      {
        metal_type: "SILVER_FUTURE",
        ltp: quotes.silver.ltp,
        open: quotes.silver.ltp,
        high: quotes.silver.high,
        low: quotes.silver.low,
        close: quotes.silver.ltp,
        provider: provider.name,
      },
    ]);
  } catch (e) {
    console.error("[pull-live-rates] rates_history insert failed:", e instanceof Error ? e.message : String(e));
  }
  try {
    const recalc = await recalculateAllRates(supabase);
    console.log("[pull-live-rates] recalculateAllRates", recalc);
  } catch (e) {
    console.error("[pull-live-rates] recalculateAllRates failed:", e instanceof Error ? e.message : String(e));
  }
  try {
    await aggregateMinuteCandles(supabase, provider.name);
  } catch (e) {
    console.error("[pull-live-rates] aggregateMinuteCandles failed:", e instanceof Error ? e.message : String(e));
  }
  return { provider: provider.name, quotes };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Backfill-aware 1m OHLC aggregation. For each metal, we look up the last
// stored candle_time and rebuild every 1-minute bucket from that point up to
// (and including) the current minute using rates_history ticks. If nothing
// has been aggregated yet we fall back to a bounded lookback window. UPSERT
// on (metal_type, timeframe, candle_time) keeps the operation idempotent —
// safe to run repeatedly, and it self-heals after missed executions,
// restarts, or scheduler gaps.
const MAX_BACKFILL_MINUTES = 24 * 60; // hard cap: 24h per run
const DEFAULT_LOOKBACK_MINUTES = 60;  // used when no prior candles exist

function floorToMinuteUTC(d: Date): Date {
  return new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    d.getUTCHours(), d.getUTCMinutes(), 0, 0,
  ));
}

async function aggregateMetalCandles(
  supabase: ReturnType<typeof createClient>,
  providerName: string,
  metal: "GOLD_FUTURE" | "SILVER_FUTURE",
) {
  const nowMinute = floorToMinuteUTC(new Date());

  // Find where to resume from: minute after the last stored candle.
  const { data: lastRows, error: lastErr } = await supabase
    .from("market_candles")
    .select("candle_time")
    .eq("metal_type", metal)
    .eq("timeframe", "1m")
    .order("candle_time", { ascending: false })
    .limit(1);
  if (lastErr) {
    console.error("[aggregateMinuteCandles] last-candle read failed:", metal, lastErr.message);
    return;
  }

  let windowStart: Date;
  if (lastRows && lastRows.length) {
    // Re-aggregate the last stored minute too (may still have late ticks),
    // then every minute after it up to the current minute.
    windowStart = floorToMinuteUTC(new Date((lastRows[0] as { candle_time: string }).candle_time));
  } else {
    windowStart = new Date(nowMinute.getTime() - DEFAULT_LOOKBACK_MINUTES * 60_000);
  }

  // Clamp to the hard backfill cap so a long outage cannot balloon one run.
  const earliest = new Date(nowMinute.getTime() - MAX_BACKFILL_MINUTES * 60_000);
  if (windowStart < earliest) windowStart = earliest;

  const windowEnd = new Date(nowMinute.getTime() + 60_000); // exclusive; includes current minute

  const { data: tickData, error: tickErr } = await supabase
    .from("rates_history")
    .select("ltp, created_at")
    .eq("metal_type", metal)
    .gte("created_at", windowStart.toISOString())
    .lt("created_at", windowEnd.toISOString())
    .order("created_at", { ascending: true });
  if (tickErr) {
    console.error("[aggregateMinuteCandles] ticks read failed:", metal, tickErr.message);
    return;
  }
  const ticks = (tickData ?? []) as Array<{ ltp: number; created_at: string }>;
  if (!ticks.length) return;

  // Bucket ticks by minute (UTC).
  const buckets = new Map<number, number[]>();
  for (const t of ticks) {
    const price = Number(t.ltp);
    if (!Number.isFinite(price) || price <= 0) continue;
    const ts = new Date(t.created_at).getTime();
    if (!Number.isFinite(ts)) continue;
    const bucket = Math.floor(ts / 60_000) * 60_000;
    const arr = buckets.get(bucket);
    if (arr) arr.push(price);
    else buckets.set(bucket, [price]);
  }

  if (!buckets.size) return;

  const rows = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, prices]) => ({
      metal_type: metal,
      timeframe: "1m",
      candle_time: new Date(bucket).toISOString(),
      open: prices[0],
      high: prices.reduce((m, p) => (p > m ? p : m), prices[0]),
      low: prices.reduce((m, p) => (p < m ? p : m), prices[0]),
      close: prices[prices.length - 1],
      provider: providerName,
    }));

  // Chunk to keep payloads modest during large backfills.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error: upErr } = await supabase
      .from("market_candles")
      .upsert(slice, { onConflict: "metal_type,timeframe,candle_time" });
    if (upErr) {
      console.error("[aggregateMinuteCandles] upsert failed:", metal, upErr.message);
      return;
    }
  }
  console.log(`[aggregateMinuteCandles] ${metal} upserted ${rows.length} candle(s)`);
}

async function aggregateMinuteCandles(
  supabase: ReturnType<typeof createClient>,
  providerName: string,
) {
  await Promise.all([
    aggregateMetalCandles(supabase, providerName, "GOLD_FUTURE"),
    aggregateMetalCandles(supabase, providerName, "SILVER_FUTURE"),
  ]);
}

Deno.serve(async (req) => {
  // Optional shared-secret guard. pg_cron calls with header x-cron-secret.
  if (CRON_SECRET) {
    const got = req.headers.get("x-cron-secret") || "";
    if (got !== CRON_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let cfg = await readSettings(supabase);
  cfg = { ...cfg, ...(await ensurePerformanceSettings(supabase, cfg)) };
  const results: Array<{ ok: boolean; ms: number; error?: string }> = [];
  let lastProvider = cfg.providerId;

  const invocationStart = new Date();
  console.log(
    `[pull-live-rates] invocation START ${invocationStart.toISOString()} ` +
      `loops=${cfg.loops} intervalSec=${cfg.intervalSec}`,
  );

  for (let i = 0; i < cfg.loops; i++) {
    const pullNum = i + 1;
    const t0 = Date.now();
    console.log(
      `[pull-live-rates] pull ${pullNum}/${cfg.loops} start ${new Date(t0).toISOString()}`,
    );
    try {
      const r = await pullOnce(supabase);
      lastProvider = r.provider;
      results.push({ ok: true, ms: Date.now() - t0 });
      await recordHealth(supabase, {
        last_successful_fetch: new Date().toISOString(),
        last_provider: r.provider,
        last_error: null,
        status: "ok",
        consecutive_failures: 0,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[pull-live-rates] iteration failed:", msg);
      results.push({ ok: false, ms: Date.now() - t0, error: msg });
      // increment consecutive_failures atomically via rpc-less pattern
      const { data: h } = await supabase
        .from("rates_health")
        .select("consecutive_failures")
        .eq("id", "pull-live-rates")
        .maybeSingle();
      const fails = ((h?.consecutive_failures as number | null) ?? 0) + 1;
      await recordHealth(supabase, {
        last_error: msg,
        last_error_at: new Date().toISOString(),
        last_provider: lastProvider,
        status: fails >= 3 ? "degraded" : "warning",
        consecutive_failures: fails,
      });
    }

    console.log(
      `[pull-live-rates] pull ${pullNum}/${cfg.loops} end   ${new Date().toISOString()} ` +
        `(${Date.now() - t0}ms)`,
    );
    if (i < cfg.loops - 1) await sleep(cfg.intervalSec * 1000);
  }

  const invocationEnd = new Date();
  console.log(
    `[pull-live-rates] invocation END   ${invocationEnd.toISOString()} ` +
      `totalMs=${invocationEnd.getTime() - invocationStart.getTime()}`,
  );

  return Response.json({
    ok: true,
    runs: results,
    provider: lastProvider,
    startedAt: invocationStart.toISOString(),
    endedAt: invocationEnd.toISOString(),
  });
});