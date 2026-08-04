import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type LineData,
  type LineStyleOptions,
} from "lightweight-charts";
import type { Candle } from "@/lib/rb-candles";

// Lightweight Charts renders UTCTimestamp values as UTC on the axis and
// crosshair. To display everything in Asia/Kolkata (IST, UTC+5:30) without
// touching the DB (candle_time / rates_history.created_at stay UTC), we
// shift the numeric time by +5.5h right before handing it to the chart.
// The chart then formats those "already-in-IST" seconds as UTC, which
// visually equals IST. Stored data is unchanged.
const IST_OFFSET_SECONDS = 5.5 * 60 * 60;
const toDisplayTime = (t: number): Time =>
  ((t as number) + IST_OFFSET_SECONDS) as unknown as Time;

/**
 * Reserved indicator slot. Add new overlays here (EMA20, EMA50, VWAP,
 * Support/Resistance, Buy/Sell zones) without altering the chart shell.
 */
export interface IndicatorOverlay {
  id: string;
  type: "line";
  data: LineData[];
  options?: Partial<LineStyleOptions> & { color?: string };
}

interface Props {
  candles: Candle[];
  overlays?: IndicatorOverlay[];
  height?: number;
  seriesType?: "candle" | "line";
}

// Premium black + gold palette matched to the rest of the app.
const THEME = {
  bg: "transparent",
  text: "#c8b273",
  grid: "rgba(200, 178, 115, 0.08)",
  border: "rgba(200, 178, 115, 0.25)",
  up: "#22c55e",
  down: "#ef4444",
  crosshair: "rgba(200, 178, 115, 0.55)",
};

export function CandleChart({ candles, overlays = [], height = 380, seriesType = "candle" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const overlayRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: THEME.bg },
        textColor: THEME.text,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: THEME.grid },
        horzLines: { color: THEME.grid },
      },
      rightPriceScale: { borderColor: THEME.border },
      timeScale: {
        borderColor: THEME.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: THEME.crosshair, width: 1, style: 3 },
        horzLine: { color: THEME.crosshair, width: 1, style: 3 },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    chartRef.current = chart;

    return () => {
      overlayRefs.current.clear();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      lineRef.current = null;
    };
  }, []);

  // Manage main series (candle vs line) + data
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesType === "candle") {
      if (lineRef.current) {
        chart.removeSeries(lineRef.current);
        lineRef.current = null;
      }
      if (!candleRef.current) {
        candleRef.current = chart.addSeries(CandlestickSeries, {
          upColor: THEME.up,
          downColor: THEME.down,
          borderUpColor: THEME.up,
          borderDownColor: THEME.down,
          wickUpColor: THEME.up,
          wickDownColor: THEME.down,
        });
      }
      candleRef.current.setData(
        candles.map((c) => ({
          time: toDisplayTime(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
    } else {
      if (candleRef.current) {
        chart.removeSeries(candleRef.current);
        candleRef.current = null;
      }
      if (!lineRef.current) {
        lineRef.current = chart.addSeries(LineSeries, {
          color: THEME.text,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
      }
      lineRef.current.setData(
        candles.map((c) => ({ time: toDisplayTime(c.time), value: c.close })),
      );
    }
    if (candles.length) chart.timeScale().fitContent();
  }, [candles, seriesType]);

  // Push overlays (indicator slots)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const nextIds = new Set(overlays.map((o) => o.id));

    // Remove stale overlays
    for (const [id, s] of overlayRefs.current) {
      if (!nextIds.has(id)) {
        chart.removeSeries(s);
        overlayRefs.current.delete(id);
      }
    }

    for (const ov of overlays) {
      let s = overlayRefs.current.get(ov.id);
      if (!s) {
        s = chart.addSeries(LineSeries, {
          color: ov.options?.color ?? "#c8b273",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          ...ov.options,
        });
        overlayRefs.current.set(ov.id, s);
      }
      s.setData(
        ov.data.map((d) => ({
          ...d,
          time: toDisplayTime(Number(d.time)),
        })),
      );
    }
  }, [overlays]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}