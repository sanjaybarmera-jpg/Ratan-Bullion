import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { rbSupabase } from "@/integrations/rb-supabase/client";
import {
  fetchAvailableRates,
  fetchMarketSettings,
  fetchGlobalBookingEnabled,
  pickRate,
  rateExpiry,
  computeFinalRate,
  productBookable,
  type RateRow,
} from "@/lib/rb-rates";
import { PlaceOrderModal, type PlaceOrderTarget } from "./PlaceOrderModal";
import { useRbAuth } from "./RbAuthContext";

import { toast } from "sonner";
import { Phone, MessageCircle } from "lucide-react";

function HomeSeoHeader() {
  return (
    <>
      <h1 className="sr-only">Ratan Bullion - Live Gold & Silver Rates</h1>
      <p className="sr-only">
        Ratan Bullion provides live gold and silver rates, bullion trading
        services, and easy online order management for approved customers.
      </p>
    </>
  );
}

function fmtInt(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(n));
}
function fmt(n: number | null | undefined, dp = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp }).format(Number(n));
}
function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}

type Metal = { key: string; aliases: string[]; label: string; sub: string; tone: "gold" | "silver" };

const DEALER_METALS: Metal[] = [
  { key: "gold_999", aliases: ["GOLD_999", "GOLD_999_CASH"], label: "Gold 999", sub: "10g · 24K", tone: "gold" },
  { key: "gold_9930", aliases: ["GOLD_993", "GOLD_9930", "GOLD_993_CASH"], label: "Gold 99.30", sub: "10g · STD", tone: "gold" },
  { key: "silver_999", aliases: ["SILVER_999", "SILVER_999_CASH"], label: "Silver 999", sub: "1kg · Fine", tone: "silver" },
  { key: "silver_98", aliases: ["SILVER_98", "SILVER_98_CASH"], label: "Silver 98", sub: "1kg · Std", tone: "silver" },
];
const RTGS_METALS: Metal[] = [
  { key: "gold_999_rtgs", aliases: ["GOLD_999_RTGS"], label: "Gold 999 RTGS", sub: "10g · 24K", tone: "gold" },
  { key: "gold_9930_rtgs", aliases: ["GOLD_993_RTGS", "GOLD_9930_RTGS"], label: "Gold 99.30 RTGS", sub: "10g · STD", tone: "gold" },
  { key: "silver_999_rtgs", aliases: ["SILVER_999_RTGS"], label: "Silver 999 RTGS", sub: "1kg · Fine", tone: "silver" },
  { key: "silver_98_rtgs", aliases: ["SILVER_98_RTGS"], label: "Silver 98 RTGS", sub: "1kg · Std", tone: "silver" },
];

function MetalBoard({
  heading,
  metals,
  rates,
  futures,
  canOrder,
  viewOnly,
  bookingClosed,
  onOrder,
}: {
  heading: string;
  metals: Metal[];
  rates: RateRow[];
  futures: { gold?: RateRow; silver?: RateRow };
  canOrder: boolean;
  viewOnly: boolean;
  bookingClosed: boolean;
  onOrder: (t: PlaceOrderTarget) => void;
}) {
  const rows = metals
    .map((m) => ({ m, r: pickRate(rates, m.aliases) }))
    .filter((x) => x.r && x.r.is_available !== false);
  return (
    <div className="bg-card border border-gold/25 rounded-xl overflow-hidden shadow-card transition-opacity">
      <div className="flex items-center justify-between bg-gradient-to-b from-gold/15 to-transparent px-2.5 py-1.5 border-b border-gold/20">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">{heading}</div>
      </div>
      <div className="grid grid-cols-[1.3fr_1fr_1fr] px-2.5 py-1 border-b border-border/60">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Product</div>
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-bear text-right">Sell</div>
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-bull text-right">Buy</div>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-center text-[12px] text-muted-foreground">No stock available</p>
      ) : (
        rows.map(({ m, r }, idx) => {
          const base = m.tone === "gold" ? futures.gold : futures.silver;
          const final = computeFinalRate(r, base);
          // High/Low displayed under each row are the BUY band — derived
          // from the live BUY price (mcx + premium). Updates automatically
          // whenever rates or buffers change.
          const pHigh = final.buyHigh;
          const pLow = final.buyLow;
          const avail = productBookable(r);
          const sell = final.sell;
          const buy = final.buy;
          const isGold = m.tone === "gold";
          const priceBase =
            "text-right font-price text-[19px] font-bold leading-none py-2 px-1 rounded";
          const sellActive = avail.sell && (canOrder || viewOnly);
          const buyActive = avail.buy && (canOrder || viewOnly);
          const sellCls = canOrder
            ? `${priceBase} text-foreground hover:bg-bear/10 active:bg-bear/20 cursor-pointer`
            : viewOnly
              ? `${priceBase} text-foreground/90 cursor-pointer`
              : `${priceBase} text-foreground`;
          const buyCls = canOrder
            ? `${priceBase} text-foreground hover:bg-bull/10 active:bg-bull/20 cursor-pointer`
            : viewOnly
              ? `${priceBase} text-foreground/90 cursor-pointer`
              : `${priceBase} text-foreground`;
          const offCls = `${priceBase} text-muted-foreground/70 cursor-not-allowed`;
          // View-only when booking is closed: keep rate numbers visible,
          // just disable the action. Only show "--" when the product
          // itself is unavailable (stock/sell toggles off).
          const sellDisabledCls = `${priceBase} text-foreground/70 cursor-not-allowed`;
          const buyDisabledCls = `${priceBase} text-foreground/70 cursor-not-allowed`;
          const sellUnavailable = !avail.sell;
          const buyUnavailable = !avail.buy;
          const closedMsg = "Booking is temporarily closed.";
          const sellOffMsg = sellUnavailable
            ? (avail.buy ? "Sell booking currently unavailable" : "Booking currently unavailable")
            : closedMsg;
          const buyOffMsg = buyUnavailable ? "Booking currently unavailable" : closedMsg;
          return (
            <div
              key={m.key}
              className={`px-2.5 py-2.5 ${idx < rows.length - 1 ? "border-b border-border/70" : ""}`}
            >
              <div className="grid grid-cols-[1.3fr_1fr_1fr] items-center gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center font-display text-[11px] shrink-0 ${
                      isGold
                        ? "gradient-gold text-primary-foreground"
                        : "bg-gradient-to-b from-zinc-300 to-zinc-500 text-zinc-900"
                    }`}
                  >
                    {isGold ? "Au" : "Ag"}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-[12px] leading-none truncate">{m.label}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5 truncate">{m.sub}</p>
                  </div>
                </div>
                {sellUnavailable ? (
                  <button
                    type="button"
                    onClick={() => toast.error(sellOffMsg)}
                    className={offCls}
                    aria-disabled
                  >
                    --
                  </button>
                ) : bookingClosed ? (
                  <button
                    type="button"
                    onClick={() => toast.error(closedMsg)}
                    className={sellDisabledCls}
                    aria-disabled
                  >
                    <PriceFlash value={sell}>{fmtInt(sell)}</PriceFlash>
                  </button>
                ) : sellActive && sell != null ? (
                  <button
                    type="button"
                    onClick={() =>
                      onOrder({ product: m.label, orderType: "SELL", rate: sell, unitLabel: m.sub, tone: m.tone, aliases: m.aliases })
                    }
                    className={sellCls}
                  >
                    <PriceFlash value={sell}>{fmtInt(sell)}</PriceFlash>
                  </button>
                ) : (
                  <div className={sellCls}><PriceFlash value={sell}>{fmtInt(sell)}</PriceFlash></div>
                )}
                {buyUnavailable ? (
                  <button
                    type="button"
                    onClick={() => toast.error(buyOffMsg)}
                    className={offCls}
                    aria-disabled
                  >
                    --
                  </button>
                ) : bookingClosed ? (
                  <button
                    type="button"
                    onClick={() => toast.error(closedMsg)}
                    className={buyDisabledCls}
                    aria-disabled
                  >
                    <PriceFlash value={buy}>{fmtInt(buy)}</PriceFlash>
                  </button>
                ) : buyActive && buy != null ? (
                  <button
                    type="button"
                    onClick={() =>
                      onOrder({ product: m.label, orderType: "BUY", rate: buy, unitLabel: m.sub, tone: m.tone, aliases: m.aliases })
                    }
                    className={buyCls}
                  >
                    <PriceFlash value={buy}>{fmtInt(buy)}</PriceFlash>
                  </button>
                ) : (
                  <div className={buyCls}><PriceFlash value={buy}>{fmtInt(buy)}</PriceFlash></div>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 mt-1 pl-8 text-[10px] font-price">
                <span className="text-bull">H {fmtInt(pHigh)}</span>
                <span className="text-bear">L {fmtInt(pLow)}</span>
                <span className="ml-auto text-[9px] text-muted-foreground/80 font-normal">
                  {r?.updated_at ? fmtTime(r.updated_at) : ""}
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export function LiveRatePage() {
  const auth = useRbAuth();
  const [orderTarget, setOrderTarget] = useState<PlaceOrderTarget | null>(null);
  const qc = useQueryClient();

  const ratesQ = useQuery({
    queryKey: ["rb", "rates", "all"],
    queryFn: fetchAvailableRates,
    refetchInterval: 4_000,
  });
  const marketQ = useQuery({
    queryKey: ["rb", "app_settings", "market"],
    queryFn: fetchMarketSettings,
    refetchInterval: 60_000,
  });
  // Global booking switch — fails closed. Refetch every 10s so admin
  // toggling OFF stops booking on open customer sessions without refresh.
  const bookingQ = useQuery({
    queryKey: ["rb", "app_settings", "global_booking_enabled"],
    queryFn: fetchGlobalBookingEnabled,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    placeholderData: false,
  });
  // Contract month / expiry are stamped onto the rates row itself by the
  // pull-live-rates Edge Function on every successful pull, so the frontend
  // reads them straight from the rates table (see expiryFor below).

  // Realtime: refetch immediately when admin pushes a rate update.
  useEffect(() => {
    const channel = rbSupabase
      .channel("rb-rates-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rates" },
        () => {
          qc.invalidateQueries({ queryKey: ["rb", "rates", "all"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        () => {
          qc.invalidateQueries({ queryKey: ["rb", "app_settings", "global_booking_enabled"] });
          qc.invalidateQueries({ queryKey: ["rb", "app_settings", "market"] });
        },
      )
      .subscribe();
    return () => {
      rbSupabase.removeChannel(channel);
    };
  }, [qc]);

  const rates = ratesQ.data ?? [];
  const market = marketQ.data ?? {};
  // Source of truth: dedicated server fetcher (fails closed). React state
  // is only a mirror — the actual order RPC re-checks server-side too.
  const bookingEnabled = bookingQ.data === true;

  const isApproved = auth.access === "granted";
  const isVip = isApproved && auth.isVip;
  const canOrder = isVip && bookingEnabled;

  console.info("[LiveRatePage] booking state", {
    "bookingQ.data": bookingQ.data,
    "bookingQ.status": bookingQ.status,
    "bookingQ.fetchStatus": bookingQ.fetchStatus,
    "bookingQ.error": bookingQ.error ? (bookingQ.error as Error).message : null,
    bookingEnabled,
    isApproved,
    isVip,
    canOrder,
  });

  function handleOrder(t: PlaceOrderTarget) {
    if (!isApproved || !auth.mobile) {
      toast.error("Login and dealer approval required");
      return;
    }
    if (!isVip) {
      toast.message("Order facility is available only for VIP customers.");
      return;
    }
    if (!bookingEnabled) {
      toast.error("Booking is temporarily closed.");
      return;
    }
    setOrderTarget(t);
  }

  const byId = (id: string) =>
    rates.find((r) => (r.id ?? "").toString().trim().toLowerCase() === id);

  const usdGold =
    byId("usd_gold") ?? pickRate(rates, ["USD_GOLD", "XAUUSD", "GOLD_USD"]);
  const usdSilver =
    byId("usd_silver") ?? pickRate(rates, ["USD_SILVER", "XAGUSD", "SILVER_USD"]);
  const usdInr =
    byId("usd_inr") ?? pickRate(rates, ["USD_INR", "USDINR", "INR"]);

  const goldFut =
    byId("gold") ?? pickRate(rates, ["GOLD_FUTURE", "MCX_GOLD", "FUTURE_GOLD"]);
  const silverFut =
    byId("silver") ?? pickRate(rates, ["SILVER_FUTURE", "MCX_SILVER", "FUTURE_SILVER"]);

  const usdTop = [
    { key: "usd_gold", label: "USD Gold", unit: "$/oz", r: usdGold },
    { key: "usd_silver", label: "USD Silver", unit: "$/oz", r: usdSilver },
    { key: "usdinr", label: "USD / INR", unit: "₹", r: usdInr },
  ];

  const mcxBottom: { key: string; label: string; unit: string; tone: "gold" | "silver"; r: RateRow | undefined }[] = [
    { key: "mcx_gold", label: "MCX Gold Fut", unit: "₹/10g", tone: "gold", r: goldFut },
    { key: "mcx_silver", label: "MCX Silver Fut", unit: "₹/kg", tone: "silver", r: silverFut },
  ];
  const expiryFor = (_key: string, r: RateRow | undefined): string | null =>
    rateExpiry(r);

  const tickerText =
    market.ticker_text?.trim() ||
    "Ratan Bullion • Live Dealer Rates • Rates subject to market movement";

  // Call icon → dealer_phone (fallback contact_phone). WhatsApp icon → whatsapp_phone ONLY.
  const dealerPhone = (market.dealer_phone || market.contact_phone || "").toString().trim();
  const whatsappPhone = (market.whatsapp_phone || "").toString().trim();
  const telHref = dealerPhone ? `tel:${dealerPhone.replace(/\s+/g, "")}` : "";
  const waDigitsRaw = whatsappPhone.replace(/[^0-9]/g, "");
  const waDigits = waDigitsRaw.length === 10 ? "91" + waDigitsRaw : waDigitsRaw;
  const waHref = waDigits ? `https://wa.me/${waDigits}` : "";

  // Diagnostics — verify WhatsApp icon uses `whatsapp_phone` (not dealer_phone).
  // Safe to remove after APK testing confirms behaviour.
  if (typeof window !== "undefined") {
    console.info("[LiveRatePage] contact diagnostics", {
      whatsapp_phone_setting: market.whatsapp_phone ?? null,
      dealer_phone_setting: market.dealer_phone ?? null,
      waHref,
      telHref,
    });
  }

  

  const gateMessage = isApproved
    ? null
    : "Register or wait for dealer approval to view live dealer buy/sell rates.";

  return (
    <div className="space-y-3 pt-1 pb-2">
      <HomeSeoHeader />
      {/* Notice ticker */}
      <div className="bg-card/80 border border-gold/25 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 overflow-hidden">
          <span className="text-[9px] uppercase tracking-[0.22em] text-gold font-bold shrink-0">Live</span>
          <div className="relative flex-1 overflow-hidden">
            <div className="whitespace-nowrap inline-block animate-marquee text-[11px] text-foreground/90">
              <span className="px-6">{tickerText}</span>
              <span className="px-6">{tickerText}</span>
            </div>
          </div>
        </div>
      </div>

      {ratesQ.isError && (
        <div className="bg-bear/10 border border-bear/40 text-bear rounded-xl px-3 py-2 text-[11px] font-mono break-all">
          {(ratesQ.error as Error).message}
        </div>
      )}

      {/* TOP USD */}
      <div className="grid grid-cols-3 gap-1.5 transition-opacity">
        {usdTop.map((m) => {
          const val = m.r?.mcx_ltp ?? m.r?.sell_price ?? m.r?.buy_price ?? null;
          const isUsdGold = m.key === "usd_gold";
          return (
            <div key={m.key} className="bg-card border border-gold/20 rounded-lg px-2.5 py-2.5">
              <div className="flex items-baseline justify-between gap-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{m.label}</p>
                <p className="text-[9px] text-muted-foreground/80">{m.unit}</p>
              </div>
              <p className="font-price text-[16px] font-bold mt-1.5 text-foreground leading-none">{fmt(val, 2)}</p>
              {isUsdGold ? (
                <div className="flex items-center justify-between gap-2 mt-2 text-[9px] font-price">
                  <span className="text-bull truncate min-w-0 text-left">H {fmt(m.r?.high, 2)}</span>
                  <span className="text-bear truncate min-w-0 text-right">L {fmt(m.r?.low, 2)}</span>
                </div>
              ) : (
                <div className="flex justify-between mt-2 text-[10px] font-price">
                  <span className="text-bull">H {fmt(m.r?.high, 2)}</span>
                  <span className="text-bear">L {fmt(m.r?.low, 2)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isApproved && (
        <>
          {/* METAL board */}
          <MetalBoard
            heading="Metal"
            metals={DEALER_METALS}
            rates={rates}
            futures={{ gold: goldFut, silver: silverFut }}
            canOrder={canOrder}
            viewOnly={isApproved && !isVip}
            bookingClosed={!bookingEnabled}
            onOrder={handleOrder}
          />

          <MetalBoard
            heading="RTGS"
            metals={RTGS_METALS}
            rates={rates}
            futures={{ gold: goldFut, silver: silverFut }}
            canOrder={canOrder}
            viewOnly={isApproved && !isVip}
            bookingClosed={!bookingEnabled}
            onOrder={handleOrder}
          />

        </>
      )}

      {/* MCX Futures */}
      <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground px-1 pt-0.5">MCX Futures</p>
      <div className="grid grid-cols-2 gap-1.5 transition-opacity">
        {mcxBottom.map((m) => {
          const ltp = m.r?.mcx_ltp ?? null;
          const exp = expiryFor(m.key, m.r);
          return (
            <div key={m.key} className="bg-card border border-gold/20 rounded-lg px-2.5 py-2.5">
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div
                    className={`w-6 h-6 rounded-md flex items-center justify-center font-display text-[10px] shrink-0 ${
                      m.tone === "gold"
                        ? "gradient-gold text-primary-foreground"
                        : "bg-gradient-to-b from-zinc-300 to-zinc-500 text-zinc-900"
                    }`}
                  >
                    {m.tone === "gold" ? "Au" : "Ag"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold truncate leading-tight">{m.label}</p>
                    {exp && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">Exp. {exp}</p>
                    )}
                  </div>
                </div>
              </div>
              <p className="font-price text-[17px] font-bold mt-2 text-foreground leading-none">{fmtInt(ltp)}</p>
              <div className="flex justify-between mt-2 text-[10px] font-price">
                <span className="text-bull">H {fmtInt(m.r?.high)}</span>
                <span className="text-bear">L {fmtInt(m.r?.low)}</span>
                <span className="text-muted-foreground">{m.unit}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Call / WhatsApp */}
      {(telHref || waHref) && (
        <>
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="fixed left-4 bottom-[82px] z-50 w-12 h-12 rounded-full border border-emerald-500/40 bg-emerald-500 shadow-lg flex items-center justify-center hover:bg-emerald-600 active:scale-95 transition"
              aria-label="WhatsApp dealer"
            >
              <MessageCircle className="h-6 w-6 text-white" />
            </a>
          )}
          {telHref && (
            <a
              href={telHref}
              className="fixed right-4 bottom-[82px] z-50 w-12 h-12 rounded-full border border-gold/40 bg-gold shadow-lg flex items-center justify-center hover:brightness-110 active:scale-95 transition"
              aria-label="Call dealer"
            >
              <Phone className="h-6 w-6 text-primary-foreground" />
            </a>
          )}
        </>
      )}

      {gateMessage && (
        <div className="bg-card border border-gold/25 rounded-xl px-3 py-3 text-center flex items-center justify-center gap-2">
          <span className="text-gold">🔒</span>
          <p className="text-[11px] text-foreground/90 leading-relaxed">{gateMessage}</p>
        </div>
      )}

      <p className="text-center text-[9px] text-muted-foreground px-2 leading-relaxed">
        Rates are indicative and subject to market fluctuation. Final confirmation depends on dealer/admin approval.
      </p>

      <PlaceOrderModal
        open={!!orderTarget}
        target={orderTarget}
        liveRate={(() => {
          if (!orderTarget?.aliases) return orderTarget?.rate ?? null;
          const prod = pickRate(rates, orderTarget.aliases);
          const base = orderTarget.tone === "silver" ? silverFut : goldFut;
          const f = computeFinalRate(prod, base);
          return orderTarget.orderType === "BUY" ? f.buy : f.sell;
        })()}
        onClose={() => setOrderTarget(null)}
      />
    </div>
  );
}

function PriceFlash({ value, children }: { value: number | null; children: React.ReactNode }) {
  const prevRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<{ visible: boolean; diff: number; dir: "up" | "down" } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value == null) {
      prevRef.current = null;
      return;
    }
    const prev = prevRef.current;
    prevRef.current = value;

    if (prev != null && prev !== value) {
      const diff = value - prev;
      if (diff !== 0) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setFlash({ visible: true, diff, dir: diff > 0 ? "up" : "down" });
        timerRef.current = setTimeout(() => {
          setFlash((f) => (f ? { ...f, visible: false } : null));
        }, 2000);
      }
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value]);

  return (
    <span className="relative inline-block">
      {children}
      {flash && (
        <span
          className={`absolute top-full right-0 mt-0.5 text-[9px] font-bold font-price leading-none whitespace-nowrap transition-opacity duration-500 ${flash.visible ? "opacity-100" : "opacity-0"} ${flash.dir === "up" ? "text-bull" : "text-bear"}`}
        >
          {flash.dir === "up" ? "▲" : "▼"} {flash.diff > 0 ? "+" : ""}{Math.round(flash.diff)}
        </span>
      )}
    </span>
  );
}