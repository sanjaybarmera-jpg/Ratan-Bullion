import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { adminListRates, adminUpdateRate } from "@/lib/rb-admin.functions";
import { computeFinalRate, type RateRow } from "@/lib/rb-rates";

type Rate = {
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
};

function numField(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function normalize(s: string | null | undefined) {
  return (s ?? "").toString().trim().toUpperCase().replace(/[\s\-/.]+/g, "_");
}

type Target = { label: string; aliases: string[] };

const CASH_TARGETS: Target[] = [
  { label: "Gold 999", aliases: ["GOLD_999", "GOLD999", "GOLD_999_CASH"] },
  { label: "Gold 99.30", aliases: ["GOLD_9930", "GOLD_99_30", "GOLD_99.30", "GOLD_9930_CASH"] },
  { label: "Silver 999", aliases: ["SILVER_999", "SILVER999", "SILVER_999_CASH"] },
  { label: "Silver 98", aliases: ["SILVER_98", "SILVER98", "SILVER_98_CASH"] },
];

const RTGS_TARGETS: Target[] = [
  { label: "Gold 999 RTGS", aliases: ["GOLD_999_RTGS", "GOLD999_RTGS"] },
  { label: "Gold 99.30 RTGS", aliases: ["GOLD_9930_RTGS", "GOLD_99_30_RTGS", "GOLD_99.30_RTGS"] },
  { label: "Silver 999 RTGS", aliases: ["SILVER_999_RTGS", "SILVER999_RTGS"] },
  { label: "Silver 98 RTGS", aliases: ["SILVER_98_RTGS", "SILVER98_RTGS"] },
];

function findRate(rows: Rate[], target: Target): Rate | undefined {
  const wanted = new Set(target.aliases.map(normalize));
  return rows.find((r) => wanted.has(normalize(r.metal_type)));
}

function RateCard({
  token,
  label,
  r,
  base,
}: {
  token: string;
  label: string;
  r: Rate | undefined;
  base: Rate | undefined;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(adminUpdateRate);
  const [premium, setPremium] = useState<string>(r?.premium != null ? String(r.premium) : "");
  const [spread, setSpread] = useState<string>(r?.spread != null ? String(r.spread) : "");
  const [available, setAvailable] = useState<boolean>(!!r?.is_available);
  const [sellEnabled, setSellEnabled] = useState<boolean>(r?.customer_sell_enabled !== false);

  useEffect(() => {
    setPremium(r?.premium != null ? String(r.premium) : "");
    setSpread(r?.spread != null ? String(r.spread) : "");
    setAvailable(!!r?.is_available);
    setSellEnabled(r?.customer_sell_enabled !== false);
  }, [r?.id]);

  const m = useMutation({
    mutationFn: async (patch: Partial<Rate>) => {
      console.log("[admin] push rate update", { id: r!.id, label, patch });
      const res: any = await updateFn({ data: { token, id: r!.id, patch } });
      console.log("[admin] push rate update response", res);
      if (res?.unauthorized) throw new Error("Session expired");
      if (res?.ok !== true) throw new Error(res?.error || "Update failed");
      return res;
    },
    onSuccess: () => {
      toast.success(`${label} updated`);
      qc.invalidateQueries({ queryKey: ["admin-rates"] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Failed to save";
      console.error("[admin] push rate update error", e);
      toast.error(`${label}: ${msg}`);
    },
  });

  if (!r) {
    return (
      <div className="rounded-2xl border border-dashed border-primary/30 bg-card/40 px-3 py-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-primary">{label}</h3>
        <span className="text-[10px] text-muted-foreground">Not configured</span>
      </div>
    );
  }

  function save() {
    m.mutate({
      premium: numField(premium),
      spread: numField(spread),
      is_available: available,
      customer_sell_enabled: sellEnabled,
    });
  }

  // Derive customer-visible final rates from raw MCX (base future row)
  // + current admin premium/spread inputs. Single source of truth lives
  // in computeFinalRate so admin preview always matches what the
  // customer sees on the Live Rate screen.
  const previewProduct = {
    ...r,
    premium: numField(premium),
    spread: numField(spread),
  } as unknown as RateRow;
  const final = computeFinalRate(previewProduct, (base ?? r) as unknown as RateRow);
  // Admin perspective: dealer Sell = customer Buy (higher), dealer Buy = customer Sell (lower).
  const liveSell = final.buy;
  const liveBuy = final.sell;
  const previewHigh = final.high;
  const previewLow = final.low;

  return (
    <div className="rounded-2xl border border-primary/30 bg-gradient-to-b from-card to-background p-3 space-y-2 shadow-[0_0_0_1px_rgba(212,175,55,0.05)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-foreground truncate">{label}</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            MCX {fmt(base?.mcx_ltp ?? r.mcx_ltp)}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 items-end">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Stock</span>
            <button
              type="button"
              onClick={() => setAvailable((v) => !v)}
              className={`relative inline-flex items-center h-6 w-12 rounded-full transition-colors ${available ? "bg-primary" : "bg-muted"}`}
              aria-label="Toggle stock availability"
            >
              <span className={`absolute text-[9px] font-bold ${available ? "left-1.5 text-green-500" : "right-1.5 text-red-400"}`}>
                {available ? "ON" : "OFF"}
              </span>
              <span
                className={`inline-block h-5 w-5 rounded-full bg-black shadow transform transition-transform ${available ? "translate-x-6" : "translate-x-0.5"}`}
              />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Sell</span>
            <button
              type="button"
              onClick={() => setSellEnabled((v) => !v)}
              className={`relative inline-flex items-center h-6 w-12 rounded-full transition-colors ${sellEnabled ? "bg-primary" : "bg-muted"}`}
              aria-label="Toggle customer sell"
            >
              <span className={`absolute text-[9px] font-bold ${sellEnabled ? "left-1.5 text-green-500" : "right-1.5 text-red-400"}`}>
                {sellEnabled ? "ON" : "OFF"}
              </span>
              <span
                className={`inline-block h-5 w-5 rounded-full bg-black shadow transform transition-transform ${sellEnabled ? "translate-x-6" : "translate-x-0.5"}`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Premium</span>
          <input
            type="number"
            step="0.01"
            value={premium}
            onChange={(e) => setPremium(e.target.value)}
            className="w-full h-10 rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Spread</span>
          <input
            type="number"
            step="0.01"
            value={spread}
            onChange={(e) => setSpread(e.target.value)}
            className="w-full h-10 rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="rounded-xl bg-background/60 border border-border px-3 py-1.5 flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-red-500">Sell</div>
          <div className="text-sm font-bold text-foreground truncate">{fmt(liveSell)}</div>
        </div>
        <div className="rounded-xl bg-background/60 border border-border px-3 py-1.5 flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-green-500">Buy</div>
          <div className="text-sm font-bold text-foreground truncate">{fmt(liveBuy)}</div>
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground text-right">
        H {fmt(previewHigh)} · L {fmt(previewLow)}
      </div>

      <button
        onClick={save}
        disabled={m.isPending}
        className="w-full h-10 rounded-xl bg-gradient-to-r from-yellow-500 via-primary to-yellow-600 text-black text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" />Push Update</>}
      </button>

      {m.error ? (
        <p className="text-[11px] text-destructive">
          {m.error instanceof Error ? m.error.message : "Save failed"}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  token,
  rows,
  targets,
  bases,
}: {
  title: string;
  token: string;
  rows: Rate[];
  targets: Target[];
  bases: { gold?: Rate; silver?: Rate };
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-1.5">
        {targets.map((t) => {
          const isSilver = /SILVER/i.test(t.label);
          const base = isSilver ? bases.silver : bases.gold;
          return (
            <RateCard
              key={t.label}
              token={token}
              label={t.label}
              r={findRate(rows, t)}
              base={base}
            />
          );
        })}
      </div>
    </section>
  );
}

export function RatesTab({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const listFn = useServerFn(adminListRates);
  const q = useQuery({
    queryKey: ["admin-rates"],
    queryFn: async () => {
      const r: any = await listFn({ data: { token } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { rates: Rate[] };
    },
  });
  if (q.isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const rows = q.data?.rates ?? [];
  const byId = (id: string) =>
    rows.find((r) => (r.id ?? "").toString().trim().toLowerCase() === id);
  const goldBase = byId("gold");
  const silverBase = byId("silver");
  return (
    <div className="space-y-3">
      <Section title="Cash Rates" token={token} rows={rows} targets={CASH_TARGETS} bases={{ gold: goldBase, silver: silverBase }} />
      <Section title="RTGS Rates" token={token} rows={rows} targets={RTGS_TARGETS} bases={{ gold: goldBase, silver: silverBase }} />
    </div>
  );
}