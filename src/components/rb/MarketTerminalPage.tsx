import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  aggregateCandles,
  fetchRateHistory,
  TIMEFRAME_LABELS,
  type Candle,
  type MetalType,
  type Timeframe,
} from "@/lib/rb-candles";
import { CandleChart, type IndicatorOverlay } from "./CandleChart";
import { atr, ema, rsi, toLineData, vwapLine } from "@/lib/rb-indicators";
import { fetchAvailableRates, pickRate, type RateRow } from "@/lib/rb-rates";
import { fetchActiveNews } from "@/lib/rb-news";
import { rbSupabase } from "@/integrations/rb-supabase/client";
import { getMcxMarketStatus } from "@/lib/mcx-market-status";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Activity,
  ChevronDown,
  Loader2,
  Newspaper,
  TrendingDown,
  TrendingUp,
  Minus,
  CandlestickChart as CandleIcon,
  LineChart as LineIcon,
} from "lucide-react";

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
const METALS: { key: MetalType; label: string; short: string; dp: number }[] = [
  { key: "GOLD_FUTURE", label: "Gold Future", short: "Au", dp: 0 },
  { key: "SILVER_FUTURE", label: "Silver Future", short: "Ag", dp: 0 },
];
type TerminalTab = "overview" | "chart" | "analysis" | "news";
const TABS: { key: TerminalTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "chart", label: "Chart" },
  { key: "analysis", label: "Analysis" },
  { key: "news", label: "News" },
];

function fmt(n: number | null | undefined, dp = 2) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: dp,
    minimumFractionDigits: dp,
  }).format(Number(n));
}
function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

function computeAnalysis(rate: RateRow | undefined, candles: Candle[]) {
  const price = rate?.mcx_ltp ?? (candles.at(-1)?.close ?? null);
  const high = rate?.high ?? null;
  const low = rate?.low ?? null;

  const closes = candles.map((c) => c.close);
  const ema20Arr = ema(closes, 20);
  const ema50Arr = ema(closes, 50);
  const vwapArr = vwapLine(candles);
  const rsiVal = rsi(closes, 14);
  const atrVal = atr(candles, 14);

  const ema20 = ema20Arr.at(-1) ?? null;
  const ema50 = ema50Arr.at(-1) ?? null;
  const vwap = vwapArr.at(-1) ?? null;

  // Pivot levels (classic).
  let pivot: number | null = null;
  let r1: number | null = null;
  let r2: number | null = null;
  let s1: number | null = null;
  let s2: number | null = null;
  if (high != null && low != null && price != null) {
    pivot = (high + low + price) / 3;
    r1 = 2 * pivot - low;
    s1 = 2 * pivot - high;
    r2 = pivot + (high - low);
    s2 = pivot - (high - low);
  }

  // Trend / sentiment / confidence.
  let bullPts = 0;
  let total = 0;
  if (price != null && ema20 != null) {
    total++;
    if (price > ema20) bullPts++;
  }
  if (ema20 != null && ema50 != null) {
    total++;
    if (ema20 > ema50) bullPts++;
  }
  if (price != null && vwap != null) {
    total++;
    if (price > vwap) bullPts++;
  }
  if (rsiVal != null) {
    total++;
    if (rsiVal > 55) bullPts++;
    else if (rsiVal > 45) bullPts += 0.5;
  }
  if (high != null && low != null && price != null && high > low) {
    total++;
    const pos = (price - low) / (high - low);
    if (pos > 0.55) bullPts++;
    else if (pos > 0.45) bullPts += 0.5;
  }

  const bullRatio = total > 0 ? bullPts / total : null;
  let sentiment: "bullish" | "bearish" | "neutral" | "unknown" = "unknown";
  let confidence: number | null = null;
  if (bullRatio != null) {
    confidence = Math.round(Math.abs(bullRatio - 0.5) * 200);
    if (bullRatio > 0.6) sentiment = "bullish";
    else if (bullRatio < 0.4) sentiment = "bearish";
    else sentiment = "neutral";
  }

  // Trend strength via EMA gap.
  const trendStrength =
    ema20 != null && ema50 != null && ema50 !== 0
      ? Math.min(100, Math.round((Math.abs(ema20 - ema50) / ema50) * 1000))
      : null;

  // Momentum from RSI distance to 50.
  const momentum =
    rsiVal != null ? Math.round(Math.min(100, Math.abs(rsiVal - 50) * 2)) : null;

  // Volatility: ATR as % of price.
  const volPct =
    atrVal != null && price ? (atrVal / price) * 100 : null;
  let volatility: "low" | "medium" | "high" | "unknown" = "unknown";
  if (volPct != null) {
    if (volPct < 0.3) volatility = "low";
    else if (volPct < 0.8) volatility = "medium";
    else volatility = "high";
  }

  const trendWord =
    sentiment === "bullish"
      ? "buyers holding control"
      : sentiment === "bearish"
        ? "sellers pressuring price"
        : sentiment === "neutral"
          ? "a balanced tone"
          : "insufficient data";
  const volWord =
    volatility === "high"
      ? "elevated volatility"
      : volatility === "low"
        ? "subdued volatility"
        : volatility === "medium"
          ? "moderate volatility"
          : "unknown volatility";
  const summary = `${trendWord} with ${volWord}. Confidence ${confidence ?? 0}%. Educational observation only — not a buy/sell call.`;

  const changeAbs =
    price != null && candles.length ? price - candles[0].open : null;
  const changePct =
    changeAbs != null && candles[0]?.open ? (changeAbs / candles[0].open) * 100 : null;

  return {
    price,
    high,
    low,
    open: candles[0]?.open ?? null,
    close: price,
    changeAbs,
    changePct,
    ema20,
    ema50,
    vwap,
    rsi: rsiVal,
    atr: atrVal,
    pivot,
    r1,
    r2,
    s1,
    s2,
    sentiment,
    confidence,
    trendStrength,
    momentum,
    volatility,
    summary,
    ema20Arr,
    ema50Arr,
    vwapArr,
  };
}

function SentimentBadge({
  sentiment,
  confidence,
}: {
  sentiment: "bullish" | "bearish" | "neutral" | "unknown";
  confidence: number | null;
}) {
  const map = {
    bullish: { cls: "bg-bull/15 border-bull/40 text-bull", Icon: TrendingUp, label: "Bullish" },
    bearish: { cls: "bg-bear/15 border-bear/40 text-bear", Icon: TrendingDown, label: "Bearish" },
    neutral: { cls: "bg-gold/15 border-gold/40 text-gold", Icon: Minus, label: "Neutral" },
    unknown: { cls: "bg-muted/20 border-border text-muted-foreground", Icon: Minus, label: "—" },
  } as const;
  const m = map[sentiment];
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${m.cls}`}>
      <m.Icon className="w-3.5 h-3.5" />
      <span className="text-[11px] font-bold uppercase tracking-wider">{m.label}</span>
      {confidence != null && (
        <span className="font-mono text-[11px] font-bold opacity-80">{confidence}%</span>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "default" }: {
  label: string; value: string; tone?: "default" | "bull" | "bear" | "gold";
}) {
  const toneCls =
    tone === "bull" ? "text-bull"
      : tone === "bear" ? "text-bear"
        : tone === "gold" ? "text-gold"
          : "text-foreground";
  return (
    <div className="bg-background/40 border border-gold/15 rounded-lg px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`font-mono text-[13px] font-bold leading-none mt-1 ${toneCls}`}>{value}</div>
    </div>
  );
}

function PivotCell({ label, value, highlight }: { label: string; value: number | null; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-2 py-2 text-center ${
      highlight
        ? "bg-gradient-to-b from-gold/20 to-gold/5 border-gold/60"
        : "bg-background/40 border-gold/15"
    }`}>
      <div className={`text-[9px] uppercase tracking-[0.18em] ${highlight ? "text-gold" : "text-muted-foreground"}`}>
        {label}
      </div>
      <div className="font-mono text-[12px] font-bold mt-1 leading-none">{fmt(value, 0)}</div>
    </div>
  );
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="bg-card/70 border border-gold/25 rounded-2xl overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-3.5 py-2.5 text-left">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
              {title}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-gold transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function MarketTerminalPage() {
  const qc = useQueryClient();
  const [metal, setMetal] = useState<MetalType>("GOLD_FUTURE");
  const [tf, setTf] = useState<Timeframe>("5m");
  const [tab, setTab] = useState<TerminalTab>("overview");
  const [seriesType, setSeriesType] = useState<"candle" | "line">("candle");

  const metalMeta = METALS.find((m) => m.key === metal)!;

  const historyQ = useQuery({
    queryKey: ["rb", "rates_history", metal],
    queryFn: () => fetchRateHistory(metal, 5000),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const ratesQ = useQuery({
    queryKey: ["rb", "rates", "all"],
    queryFn: fetchAvailableRates,
    refetchInterval: 4_000,
  });
  const newsQ = useQuery({
    queryKey: ["rb-news"],
    queryFn: fetchActiveNews,
    refetchInterval: 120_000,
  });

  // Realtime refresh on rate updates.
  useEffect(() => {
    const channel = rbSupabase
      .channel("rb-terminal-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rates" },
        () => qc.invalidateQueries({ queryKey: ["rb", "rates", "all"] }),
      )
      .subscribe();
    return () => {
      rbSupabase.removeChannel(channel);
    };
  }, [qc]);

  const candles = useMemo(
    () => (historyQ.data ? aggregateCandles(historyQ.data, tf) : []),
    [historyQ.data, tf],
  );

  const rates = ratesQ.data ?? [];
  const rate =
    rates.find((r) => (r.id ?? "").toString().trim().toLowerCase() === (metal === "GOLD_FUTURE" ? "gold" : "silver")) ??
    pickRate(rates, metal === "GOLD_FUTURE"
      ? ["GOLD_FUTURE", "MCX_GOLD", "FUTURE_GOLD"]
      : ["SILVER_FUTURE", "MCX_SILVER", "FUTURE_SILVER"]);

  const a = useMemo(() => computeAnalysis(rate, candles), [rate, candles]);

  const overlays: IndicatorOverlay[] = useMemo(() => {
    if (!candles.length) return [];
    return [
      { id: "ema20", type: "line", data: toLineData(candles, a.ema20Arr), options: { color: "#f4c85c", lineWidth: 1 } },
      { id: "ema50", type: "line", data: toLineData(candles, a.ema50Arr), options: { color: "#8ab4ff", lineWidth: 1 } },
      { id: "vwap", type: "line", data: toLineData(candles, a.vwapArr), options: { color: "#c8b273", lineWidth: 1 } },
    ];
  }, [candles, a.ema20Arr, a.ema50Arr, a.vwapArr]);

  const insufficient = !historyQ.isLoading && candles.length < 2;
  const now = new Date();
  const mcx = getMcxMarketStatus(now);
  const up = (a.changeAbs ?? 0) >= 0;

  return (
    <div className="space-y-3 pb-2">
      {/* Header card */}
      <div className="bg-card border border-gold/25 rounded-2xl p-3 shadow-card space-y-3">
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-background/50 border border-gold/20">
          {METALS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetal(m.key)}
              className={`py-2 rounded-lg text-[11px] font-semibold tracking-[0.15em] uppercase transition ${
                metal === m.key
                  ? "bg-gradient-to-b from-gold/25 to-gold/5 text-gold shadow-inner"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {metalMeta.label} · MCX
            </div>
            <div className="font-mono text-2xl font-bold text-white mt-1">
              {fmt(a.price, metalMeta.dp)}
            </div>
            <div
              className={`font-mono text-xs font-semibold mt-1 ${
                up ? "text-bull" : "text-bear"
              }`}
            >
              {a.changeAbs != null
                ? `${up ? "▲" : "▼"} ${fmt(a.changeAbs, 2)} (${(a.changePct ?? 0).toFixed(2)}%)`
                : "—"}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <SentimentBadge sentiment={a.sentiment} confidence={a.confidence} />
            <div className="flex items-center gap-1.5 text-[10px]">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  mcx.isOpen ? "bg-bull animate-pulse-gold" : "bg-bear"
                }`}
              />
              <span
                className={`uppercase tracking-[0.18em] font-bold ${
                  mcx.isOpen ? "text-bull" : "text-bear"
                }`}
              >
                {mcx.isOpen ? "Live" : "Closed"}
              </span>
              <span className="text-muted-foreground/70 font-mono ml-1">
                {fmtTime(rate?.updated_at)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-card/60 border border-gold/20">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`py-1.5 rounded-lg text-[10px] font-semibold tracking-[0.15em] uppercase transition ${
              tab === t.key
                ? "bg-gold/20 text-gold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <Section title="Market Statistics">
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Open" value={fmt(a.open, metalMeta.dp)} />
              <Stat label="High" value={fmt(a.high, metalMeta.dp)} tone="bull" />
              <Stat label="Low" value={fmt(a.low, metalMeta.dp)} tone="bear" />
              <Stat label="Current" value={fmt(a.price, metalMeta.dp)} tone="gold" />
              <Stat label="Close" value={fmt(a.close, metalMeta.dp)} />
              <Stat
                label="Change %"
                value={a.changePct != null ? `${up ? "+" : ""}${a.changePct.toFixed(2)}%` : "—"}
                tone={up ? "bull" : "bear"}
              />
            </div>
          </Section>

          <Section title="Technical Levels">
            <div className="grid grid-cols-5 gap-1.5">
              <PivotCell label="S2" value={a.s2} />
              <PivotCell label="S1" value={a.s1} />
              <PivotCell label="Pivot" value={a.pivot} highlight />
              <PivotCell label="R1" value={a.r1} />
              <PivotCell label="R2" value={a.r2} />
            </div>
            <p className="text-[9px] text-muted-foreground/70 text-center mt-1.5">
              Classic pivots · (H + L + C) / 3
            </p>
          </Section>

          <Section title="Indicators">
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="EMA 20" value={fmt(a.ema20, metalMeta.dp)} tone="gold" />
              <Stat label="EMA 50" value={fmt(a.ema50, metalMeta.dp)} />
              <Stat label="VWAP" value={fmt(a.vwap, metalMeta.dp)} />
              <Stat
                label="RSI 14"
                value={a.rsi != null ? a.rsi.toFixed(1) : "—"}
                tone={a.rsi == null ? "default" : a.rsi > 70 ? "bear" : a.rsi < 30 ? "bull" : "gold"}
              />
              <Stat label="ATR 14" value={fmt(a.atr, 2)} />
              <Stat
                label="Vol %"
                value={a.atr != null && a.price ? `${((a.atr / a.price) * 100).toFixed(2)}%` : "—"}
              />
            </div>
          </Section>
        </>
      )}

      {tab === "chart" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex gap-1 p-1 rounded-xl bg-card/60 border border-gold/20 flex-1 overflow-x-auto">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTf(t)}
                  className={`flex-1 min-w-[40px] py-1.5 rounded-lg text-[11px] font-semibold tracking-wider uppercase transition ${
                    tf === t ? "bg-gold/20 text-gold" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {TIMEFRAME_LABELS[t]}
                </button>
              ))}
            </div>
            <div className="flex p-1 rounded-xl bg-card/60 border border-gold/20">
              <button
                onClick={() => setSeriesType("candle")}
                className={`p-1.5 rounded-lg transition ${
                  seriesType === "candle" ? "bg-gold/20 text-gold" : "text-muted-foreground"
                }`}
                aria-label="Candlestick"
              >
                <CandleIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setSeriesType("line")}
                className={`p-1.5 rounded-lg transition ${
                  seriesType === "line" ? "bg-gold/20 text-gold" : "text-muted-foreground"
                }`}
                aria-label="Line"
              >
                <LineIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="relative rounded-2xl border border-gold/20 bg-card/60 p-2">
            {historyQ.isLoading ? (
              <div className="h-[380px] flex items-center justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin text-gold" />
              </div>
            ) : insufficient ? (
              <div className="h-[380px] flex flex-col items-center justify-center text-center px-6 gap-2">
                <div className="text-gold text-sm font-semibold tracking-wide">
                  Collecting market history…
                </div>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Chart will become available as more data is recorded.
                </p>
              </div>
            ) : (
              <CandleChart candles={candles} overlays={overlays} seriesType={seriesType} height={380} />
            )}
          </div>

          <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#f4c85c]" /> EMA20</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#8ab4ff]" /> EMA50</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#c8b273]" /> VWAP</span>
          </div>
        </div>
      )}

      {tab === "analysis" && (
        <>
          <Section title="Market Analysis">
            <div className="grid grid-cols-3 gap-1.5">
              <Stat
                label="Trend Strength"
                value={a.trendStrength != null ? `${a.trendStrength}%` : "—"}
                tone="gold"
              />
              <Stat
                label="Momentum"
                value={a.momentum != null ? `${a.momentum}%` : "—"}
                tone={a.rsi != null && a.rsi >= 50 ? "bull" : "bear"}
              />
              <Stat
                label="Volatility"
                value={
                  a.volatility === "unknown"
                    ? "—"
                    : a.volatility.charAt(0).toUpperCase() + a.volatility.slice(1)
                }
                tone={a.volatility === "high" ? "bear" : a.volatility === "low" ? "bull" : "gold"}
              />
            </div>
            <div className="mt-2.5 rounded-lg border border-gold/20 bg-gradient-to-b from-gold/10 to-transparent px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-gold" />
                <div className="text-[10px] uppercase tracking-[0.18em] text-gold font-bold">
                  Auto Market Summary
                </div>
              </div>
              <p className="text-[12px] text-foreground/90 mt-1.5 leading-snug">{a.summary}</p>
            </div>
          </Section>

          <Section title="Technical Levels" defaultOpen={false}>
            <div className="grid grid-cols-5 gap-1.5">
              <PivotCell label="S2" value={a.s2} />
              <PivotCell label="S1" value={a.s1} />
              <PivotCell label="Pivot" value={a.pivot} highlight />
              <PivotCell label="R1" value={a.r1} />
              <PivotCell label="R2" value={a.r2} />
            </div>
          </Section>

          <Section title="Indicators" defaultOpen={false}>
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="EMA 20" value={fmt(a.ema20, metalMeta.dp)} tone="gold" />
              <Stat label="EMA 50" value={fmt(a.ema50, metalMeta.dp)} />
              <Stat label="VWAP" value={fmt(a.vwap, metalMeta.dp)} />
              <Stat
                label="RSI 14"
                value={a.rsi != null ? a.rsi.toFixed(1) : "—"}
                tone={a.rsi == null ? "default" : a.rsi > 70 ? "bear" : a.rsi < 30 ? "bull" : "gold"}
              />
              <Stat label="ATR 14" value={fmt(a.atr, 2)} />
              <Stat
                label="Vol %"
                value={a.atr != null && a.price ? `${((a.atr / a.price) * 100).toFixed(2)}%` : "—"}
              />
            </div>
          </Section>
        </>
      )}

      {tab === "news" && (
        <>
          <Section title="Bullion News">
            {newsQ.isLoading && (
              <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin text-gold" />
                <span className="text-xs">Loading news…</span>
              </div>
            )}
            {!newsQ.isLoading && (newsQ.data?.length ?? 0) === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-center gap-1.5">
                <Newspaper className="w-6 h-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">No news available.</p>
              </div>
            )}
            {!newsQ.isLoading && (newsQ.data?.length ?? 0) > 0 && (
              <div className="space-y-2">
                {(newsQ.data ?? []).map((n) => (
                  <article
                    key={n.id}
                    className="rounded-lg border border-gold/15 bg-background/40 p-2.5"
                  >
                    <h4 className="text-[13px] font-semibold text-gold leading-tight">
                      {n.title || "News"}
                    </h4>
                    <p className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                      {n.created_at
                        ? new Date(n.created_at).toLocaleString("en-IN", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })
                        : "—"}
                    </p>
                    {n.description && (
                      <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/90">
                        {n.description}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </Section>

          <Section title="Economic Calendar" defaultOpen={false}>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Economic calendar updates will appear here as they are published by the
              desk. Watch for US CPI, FOMC decisions, RBI policy, and MCX contract
              expiries — these typically drive bullion volatility.
            </p>
          </Section>

          <Section title="USD Index Updates" defaultOpen={false}>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              A stronger US Dollar Index (DXY) usually pressures gold and silver,
              while a weakening DXY tends to support bullion. Live DXY updates will
              be posted here by the desk.
            </p>
          </Section>
        </>
      )}

      <p className="text-[10px] text-muted-foreground/70 text-center leading-snug px-2">
        Educational market terminal built from recorded MCX ticks. Observations only —
        not financial advice or a buy/sell recommendation.
      </p>
    </div>
  );
}