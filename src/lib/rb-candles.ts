import { rbSupabase } from "@/integrations/rb-supabase/client";

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type MetalType = "GOLD_FUTURE" | "SILVER_FUTURE";

export interface Candle {
  time: number; // unix seconds (bucket start, UTC)
  open: number;
  high: number;
  low: number;
  close: number;
}

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
};

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
};

interface HistoryRow {
  ltp: number;
  high: number | null;
  low: number | null;
  open: number | null;
  close: number | null;
  created_at: string;
}

/**
 * Fetch raw rate history rows for a metal, most recent first-limited slice.
 * Ordered ascending by created_at for chart consumption.
 */
export async function fetchRateHistory(
  metalType: MetalType,
  limit = 5000,
): Promise<HistoryRow[]> {
  const { data, error } = await rbSupabase
    .from("rates_history")
    .select("ltp, high, low, open, close, created_at")
    .eq("metal_type", metalType)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as HistoryRow[]).reverse();
}

/**
 * Aggregate raw tick rows into OHLC candles for a given timeframe.
 * Uses ltp for OHLC construction so aggregation stays consistent across
 * providers whose per-row open/close may only mirror ltp.
 */
export function aggregateCandles(rows: HistoryRow[], tf: Timeframe): Candle[] {
  const bucket = TIMEFRAME_SECONDS[tf];
  if (!rows.length) return [];

  const map = new Map<number, Candle>();
  for (const r of rows) {
    const price = Number(r.ltp);
    if (!Number.isFinite(price)) continue;
    const ts = Math.floor(new Date(r.created_at).getTime() / 1000);
    if (!Number.isFinite(ts)) continue;
    const bucketStart = Math.floor(ts / bucket) * bucket;

    const existing = map.get(bucketStart);
    if (!existing) {
      map.set(bucketStart, {
        time: bucketStart,
        open: price,
        high: price,
        low: price,
        close: price,
      });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}