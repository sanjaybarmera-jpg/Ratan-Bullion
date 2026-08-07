import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ClipboardList } from "lucide-react";
import { useRbAuth } from "./RbAuthContext";
import { getDeviceId } from "@/lib/rb-device";
import { getMyOrders } from "@/lib/rb-customer.functions";

type OrderRow = {
  id: string;
  product: string | null;
  order_type: string | null;
  quantity: number | null;
  rate: number | null;
  total_amount: number | null;
  status: string | null;
  admin_note: string | null;
  created_at: string | null;
};

function fmtInr(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n));
}
function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status || "pending").toLowerCase();
  const cls =
    s === "completed" || s === "approved" ? "border-primary/50 text-primary"
    : s === "rejected" || s === "cancelled" ? "border-destructive/50 text-destructive"
    : "border-border text-muted-foreground";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>
      {s}
    </span>
  );
}

function OrderCard({ o }: { o: OrderRow }) {
  return (
    <article className="rounded-lg border border-border bg-card p-2.5 shadow-sm">
      {/* Row 1: Order type + product + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-foreground">
            {(o.order_type || "").toUpperCase()} {o.product || ""}
          </span>
        </div>
        <StatusBadge status={o.status} />
      </div>
      {/* Row 2: Date/time */}
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {fmtDateTime(o.created_at)}
      </p>
      {/* Row 3: Qty | Rate | Total compact */}
      <div className="mt-1 flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">Qty: <span className="font-medium text-foreground">{fmtInr(o.quantity)}</span></span>
        <span className="text-muted-foreground">Rate: <span className="font-medium text-foreground">₹{fmtInr(o.rate)}</span></span>
        <span className="text-muted-foreground">Total: <span className="font-semibold text-primary">₹{fmtInr(o.total_amount)}</span></span>
      </div>
      {o.admin_note && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground/80">Note:</span> {o.admin_note}
        </p>
      )}
    </article>
  );
}

export function OrdersPage() {
  const auth = useRbAuth();
  const fetchOrders = useServerFn(getMyOrders);
  const isApproved = auth.access === "granted";
  const q = useQuery({
    queryKey: ["rb-my-orders", auth.mobile],
    enabled: !!auth.mobile && isApproved,
    refetchInterval: 60_000,
    queryFn: async () => {
      const r: any = await fetchOrders({ data: { mobile: auth.mobile!, deviceId: getDeviceId() } });
      if (r?.unauthorized) throw new Error("Session not approved");
      return r as { orders: OrderRow[] };
    },
  });

  const orders = q.data?.orders ?? [];

  if (!isApproved) {
    const msg =
      auth.access === "pending_approval"
        ? "Your account/device approval is pending."
        : auth.access === "device_pending" || auth.access === "device_unregistered"
        ? "This device is not approved yet."
        : "Register or wait for dealer approval to view your orders.";
    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold mt-1">My Orders</h2>
        </div>
        <div className="rounded-xl border border-gold/25 bg-card p-6 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-foreground/90">{msg}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-primary/80">Ratan Bullion</p>
        <h2 className="text-2xl font-semibold mt-1">My Orders</h2>
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : q.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-card p-5 text-sm text-destructive">
          {(q.error as Error).message}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">No orders yet.</p>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{orders.map((o) => <OrderCard key={o.id} o={o} />)}</div>
      )}
    </section>
  );
}