import type { Candle } from "./rb-candles";
import type { LineData, Time } from "lightweight-charts";

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev == null) {
      // Seed with SMA of first `period` values.
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      prev = sum / period;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close),
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Rolling VWAP-like line using typical price (no volume available). */
export function vwapLine(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = [];
  let cum = 0;
  for (let i = 0; i < candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cum += tp;
    out.push(cum / (i + 1));
  }
  return out;
}

export function toLineData(candles: Candle[], series: (number | null)[]): LineData[] {
  const out: LineData[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = series[i];
    if (v == null || !Number.isFinite(v)) continue;
    out.push({ time: candles[i].time as Time, value: v });
  }
  return out;
}