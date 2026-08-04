import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Clock, Send, CheckCircle2, XCircle, Search, RefreshCw, MessageCircle } from "lucide-react";
import { adminListOrders, adminUpdateOrder } from "@/lib/rb-admin.functions";

type Order = {
  id: string;
  customer_name: string | null;
  customer_mobile: string | null;
  product: string | null;
  order_type: string | null;
  quantity: number | null;
  rate: number | null;
  total_amount: number | null;
  status: string | null;
  admin_note: string | null;
  created_at: string | null;
};

const STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "REJECTED", "CANCELLED"];
const ACCEPTED = new Set(["CONFIRMED", "COMPLETED", "APPROVED"]);

function metalOf(product: string | null): "GOLD" | "SILVER" | null {
  const p = (product || "").toUpperCase();
  if (p.includes("GOLD")) return "GOLD";
  if (p.includes("SILVER")) return "SILVER";
  return null;
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function fmtQty(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n);
}

function NetSummaryCard({ metal, orders }: { metal: "GOLD" | "SILVER"; orders: Order[] }) {
  const { dealerBuy, dealerSell, net, status } = useMemo(() => {
    let dBuy = 0, dSell = 0;
    for (const o of orders) {
      if (metalOf(o.product) !== metal) continue;
      if (!ACCEPTED.has((o.status || "").toUpperCase())) continue;
      const q = Number(o.quantity || 0);
      const t = (o.order_type || "").toUpperCase();
      if (t === "BUY") dSell += q;       // customer BUY = dealer SELL
      else if (t === "SELL") dBuy += q;  // customer SELL = dealer BUY
    }
    const diff = dBuy - dSell;
    const st = diff > 0 ? "BUY" : diff < 0 ? "SELL" : "BALANCED";
    return { dealerBuy: dBuy, dealerSell: dSell, net: Math.abs(diff), status: st };
  }, [orders, metal]);

  const badgeCls =
    status === "BUY" ? "border-bull/50 bg-bull/10 text-bull"
    : status === "SELL" ? "border-bear/50 bg-bear/10 text-bear"
    : "border-border bg-muted/40 text-muted-foreground";

  return (
    <div className="rounded-xl border border-gold/30 bg-card p-3 shadow-card">
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold tracking-wide ${metal === "GOLD" ? "text-primary" : "text-foreground"}`}>
          {metal}
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wider ${badgeCls}`}>
          {status}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <MiniBox label="BUY" value={dealerBuy} tone="bull" />
        <MiniBox label="SELL" value={dealerSell} tone="bear" />
        <MiniBox label="NET" value={net} tone="net" />
      </div>
    </div>
  );
}

function MiniBox({ label, value, tone }: { label: string; value: number; tone: "bull" | "bear" | "net" }) {
  const labelCls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-muted-foreground";
  const valCls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-primary";
  return (
    <div className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-center">
      <p className={`text-[10px] font-semibold tracking-wider ${labelCls}`}>{label}</p>
      <p className={`mt-0.5 text-base font-bold font-price ${valCls}`}>{fmtQty(value)}</p>
    </div>
  );
}

function StatusTile({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 px-2 py-2 text-center">
      <Icon className={`mx-auto h-4 w-4 ${color}`} />
      <p className="mt-1 text-base font-bold text-foreground font-price">{value}</p>
      <p className="text-[9px] font-semibold tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function sanitizePhone(raw: string | null | undefined): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  return digits;
}

function waMessage(o: Order): string {
  const type = (o.order_type || "").toUpperCase();
  const product = o.product || "";
  const qty = fmtQty(Number(o.quantity || 0));
  const rate = o.rate ?? 0;
  return `Order Confirmed: ${type} ${product}, Qty ${qty} gm, Rate ₹${rate}`;
}

function OrderRow({ token, o }: { token: string; o: Order }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(adminUpdateOrder);
  const m = useMutation({
    mutationFn: (v: { status?: string }) =>
      updateFn({ data: { token, id: o.id, ...v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-orders"] }),
  });

  const status = (o.status || "").toUpperCase();
  const showWa = status === "CONFIRMED" || status === "COMPLETED";
  const phone = sanitizePhone(o.customer_mobile);
  const waUrl = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(waMessage(o))}`
    : "";

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-card-foreground truncate">
            {(o.order_type || "").toUpperCase()} {o.product || ""}
          </p>
          <p className="text-xs text-muted-foreground">{o.customer_name || "—"} · {o.customer_mobile || "—"}</p>
          <p className="text-[11px] text-muted-foreground">
            Qty {o.quantity ?? "—"} · Rate ₹{o.rate ?? "—"} · Total ₹{o.total_amount ?? "—"}
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => m.mutate({ status: e.target.value })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {showWa && waUrl && (
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-green-500/40 bg-green-500/10 px-2.5 py-1 text-[11px] font-medium text-green-400 hover:bg-green-500/20"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Send WhatsApp
        </a>
      )}
    </div>
  );
}

export function OrdersTab({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const listFn = useServerFn(adminListOrders);
  const qc = useQueryClient();
  const [view, setView] = useState<"active" | "completed" | "rejected" | "all">("active");
  const q = useQuery({
    queryKey: ["admin-orders", view],
    queryFn: async () => {
      const r: any = await listFn({ data: { token, view } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { orders: Order[] };
    },
  });

  const [todayOnly, setTodayOnly] = useState(true);
  const [productFilter, setProductFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const allRows = q.data?.orders ?? [];
  const todayRows = useMemo(() => allRows.filter((o) => isToday(o.created_at)), [allRows]);
  const summaryRows = todayRows; // summary always today live

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const o of allRows) if (o.product) s.add(o.product);
    return Array.from(s).sort();
  }, [allRows]);

  const filtered = useMemo(() => {
    const base = todayOnly ? todayRows : allRows;
    const q = search.trim().toLowerCase();
    return base.filter((o) => {
      if (productFilter !== "ALL" && (o.product || "") !== productFilter) return false;
      if (statusFilter !== "ALL" && (o.status || "").toUpperCase() !== statusFilter) return false;
      if (typeFilter !== "ALL" && (o.order_type || "").toUpperCase() !== typeFilter) return false;
      if (q) {
        const hay = `${o.customer_name ?? ""} ${o.customer_mobile ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, todayRows, todayOnly, productFilter, statusFilter, typeFilter, search]);

  const counts = useMemo(() => {
    let pend = 0, acc = 0, done = 0, rej = 0;
    for (const o of todayRows) {
      const s = (o.status || "").toUpperCase();
      if (s === "PENDING") pend++;
      else if (s === "CONFIRMED" || s === "APPROVED") acc++;
      else if (s === "COMPLETED") done++;
      else if (s === "REJECTED" || s === "CANCELLED") rej++;
    }
    return { pend, acc, done, rej };
  }, [todayRows]);

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">TODAY · LIVE</p>
      <div className="grid grid-cols-2 gap-2">
        <NetSummaryCard metal="GOLD" orders={summaryRows} />
        <NetSummaryCard metal="SILVER" orders={summaryRows} />
      </div>

      <div className="rounded-xl border border-border bg-card p-2.5">
        <p className="text-[10px] font-semibold tracking-wider text-muted-foreground mb-2">TODAY'S STATUS</p>
        <div className="grid grid-cols-4 gap-1.5">
          <StatusTile icon={Clock} label="PEND" value={counts.pend} color="text-primary" />
          <StatusTile icon={Send} label="ACC" value={counts.acc} color="text-sky-400" />
          <StatusTile icon={CheckCircle2} label="DONE" value={counts.done} color="text-bull" />
          <StatusTile icon={XCircle} label="REJ" value={counts.rej} color="text-bear" />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            ["active", "Active"],
            ["completed", "Completed"],
            ["rejected", "Rejected"],
            ["all", "All"],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                "rounded-full px-3 py-1 text-[11px] font-semibold border " +
                (view === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground")
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setTodayOnly((v) => !v)}
            className={
              "rounded-full px-3 py-1 text-[11px] font-semibold border " +
              (todayOnly
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground")
            }
          >
            TODAY ONLY
          </button>
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground"
          >
            <option value="ALL">All products</option>
            {productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground"
          >
            <option value="ALL">All status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground"
          >
            <option value="ALL">Buy/Sell</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search mobile / name"
              className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1.5 text-xs text-foreground"
            />
          </div>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["admin-orders"] })}
            className="rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No orders match.</p>
      ) : (
        <div className="space-y-2">{filtered.map((o) => <OrderRow key={o.id} token={token} o={o} />)}</div>
      )}
    </div>
  );
}