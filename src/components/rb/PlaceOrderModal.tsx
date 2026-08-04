import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, X, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { placeOrder, getOpenPositions } from "@/lib/rb-customer.functions";
import { useRbAuth } from "./RbAuthContext";
import { getDeviceId } from "@/lib/rb-device";

export type PlaceOrderTarget = {
  product: string;
  orderType: "BUY" | "SELL";
  rate: number;
  unitLabel?: string;
  tone?: "gold" | "silver";
  aliases?: string[];
};

function fmtInr(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

export function PlaceOrderModal({
  open,
  target,
  liveRate,
  onClose,
}: {
  open: boolean;
  target: PlaceOrderTarget | null;
  liveRate?: number | null;
  onClose: () => void;
}) {
  const auth = useRbAuth();
  const qc = useQueryClient();
  const submit = useServerFn(placeOrder);
  const fetchPositions = useServerFn(getOpenPositions);
  const [qty, setQty] = useState<string>("1");

  useEffect(() => {
    if (open) setQty("1");
  }, [open, target?.product, target?.orderType]);

  // Live open-positions for "Available Quantity" display.
  const posQ = useQuery({
    queryKey: ["rb-open-positions", auth.mobile],
    enabled: open && !!auth.mobile,
    refetchInterval: open ? 15_000 : false,
    queryFn: async () => {
      const r: any = await fetchPositions({
        data: { mobile: auth.mobile!, deviceId: getDeviceId() },
      });
      return r as {
        goldOpenGm: number;
        silverOpenGm: number;
        goldLimitGm: number;
        silverLimitGm: number;
        goldAvailableGm: number;
        silverAvailableGm: number;
      };
    },
  });

  // Current displayed rate: prefer the live rate from the parent (refreshed
  // by the rates query). Falls back to the snapshot taken when the modal
  // opened. Quantity input is preserved across rate updates.
  const displayRate =
    liveRate != null && Number.isFinite(liveRate) && liveRate > 0
      ? liveRate
      : target?.rate ?? 0;

  const m = useMutation({
    mutationFn: async () => {
      if (!target || !auth.mobile) throw new Error("Session missing");
      const q = Number(qty);
      if (!q || q <= 0) throw new Error("Enter a valid quantity");
      const perGram =
        target.tone === "silver" ? displayRate / 1000 : displayRate / 10;
      const res = await submit({
        data: {
          mobile: auth.mobile,
          deviceId: getDeviceId(),
          product: target.product,
          orderType: target.orderType,
          quantity: q,
          rate: displayRate,
          totalAmount: q * perGram,
        },
      });
      if (!res?.success) throw new Error(res?.message || "Order failed");
      return res;
    },
    onSuccess: (res) => {
      toast.success("Order placed", {
        description: `#${(res.orderId || "").toString().slice(0, 8)} · ${res.status}`,
      });
      qc.invalidateQueries({ queryKey: ["rb-my-orders"] });
      qc.invalidateQueries({ queryKey: ["rb-open-positions"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || "Order failed"),
  });

  if (!open || !target) return null;

  const qNum = Number(qty) || 0;
  const perGram =
    target.tone === "silver" ? displayRate / 1000 : displayRate / 10;
  const total = qNum * perGram;
  const isBuy = target.orderType === "BUY";

  const metal: "gold" | "silver" =
    target.tone === "silver" ? "silver" : "gold";
  const availableGm =
    metal === "gold"
      ? posQ.data?.goldAvailableGm ?? null
      : posQ.data?.silverAvailableGm ?? null;
  const limitGm = metal === "gold" ? 100 : 5000;
  const overLimit = availableGm != null && qNum > availableGm;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full sm:max-w-md bg-card border border-gold/30 rounded-t-2xl sm:rounded-2xl shadow-2xl animate-in slide-in-from-bottom-8 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                isBuy
                  ? "text-bull bg-bull/10 border border-bull/30"
                  : "text-bear bg-bear/10 border border-bear/30"
              }`}
            >
              {isBuy ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {target.orderType}
            </span>
            <h3 className="font-semibold text-sm">{target.product}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-background/40 border border-border rounded-lg px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Live Rate</p>
              <p className={`font-price text-base font-bold mt-0.5 leading-none ${isBuy ? "text-bull" : "text-bear"}`}>
                ₹ {fmtInr(displayRate)}
              </p>
              {target.unitLabel && (
                <p className="text-[9px] text-muted-foreground mt-1 uppercase tracking-wider">
                  {target.unitLabel}
                </p>
              )}
            </div>
            <div className="bg-background/40 border border-border rounded-lg px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Customer</p>
              <p className="font-semibold text-[13px] mt-0.5 truncate leading-tight">{auth.name || "—"}</p>
              <p className="text-[10px] text-muted-foreground font-mono">{auth.mobile}</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground uppercase tracking-wider">
              Available Quantity
            </span>
            <span className="font-semibold text-foreground">
              {availableGm == null ? "—" : `${availableGm} gm`}
              <span className="text-muted-foreground font-normal"> / {limitGm} gm</span>
            </span>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
              Quantity (gm)
            </label>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQty(String(Math.max(0, (Number(qty) || 0) - 1)))}
                className="w-9 h-10 rounded-lg border border-border bg-background/40 text-lg font-bold hover:border-gold/40"
              >
                −
              </button>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="flex-1 h-10 text-center font-price text-xl font-bold bg-background/40 border border-border rounded-lg focus:outline-none focus:border-gold/60"
              />
              <button
                type="button"
                onClick={() => setQty(String((Number(qty) || 0) + 1))}
                className="w-9 h-10 rounded-lg border border-border bg-background/40 text-lg font-bold hover:border-gold/40"
              >
                +
              </button>
            </div>
          </div>

          <div className="bg-gradient-to-br from-gold/10 to-transparent border border-gold/30 rounded-lg px-3 py-2 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-gold font-bold">Total Amount</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {qNum} gm × ₹ {fmtInr(perGram)}/gm
              </p>
            </div>
            <p className="font-price text-xl font-bold text-foreground leading-none whitespace-nowrap">
              ₹ {fmtInr(total)}
            </p>
          </div>

          {overLimit && (
            <p className="text-[10px] text-bear text-center">
              Maximum open {metal === "gold" ? "Gold" : "Silver"} quantity is {limitGm} gm.
              Available quantity: {availableGm} gm.
            </p>
          )}

          <button
            onClick={() => m.mutate()}
            disabled={m.isPending || qNum <= 0 || overLimit}
            className={`w-full h-11 rounded-lg font-bold uppercase tracking-wider text-sm transition disabled:opacity-50 disabled:cursor-not-allowed ${
              isBuy
                ? "bg-bull text-white hover:bg-bull/90"
                : "bg-bear text-white hover:bg-bear/90"
            }`}
          >
            {m.isPending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Placing…
              </span>
            ) : (
              `Confirm ${target.orderType}`
            )}
          </button>

          <p className="text-[9px] text-center text-muted-foreground leading-relaxed">
            Rate updates automatically. Order will be sent to dealer for confirmation.
          </p>
        </div>
      </div>
    </div>
  );
}