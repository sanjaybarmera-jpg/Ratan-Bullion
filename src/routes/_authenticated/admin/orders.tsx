import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { inr, shortDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/orders")({
  head: () => ({
    meta: [
      { title: "Orders — Ratan Jewellers Admin" },
      { name: "description", content: "Track and update customer orders and fulfilment status." },
      { property: "og:title", content: "Orders — Ratan Jewellers Admin" },
      { property: "og:description", content: "Track and update customer orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OrdersPage,
});

const STATUSES = ["pending", "confirmed", "packed", "shipped", "delivered", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

function OrdersPage() {
  const queryClient = useQueryClient();

  const { data: orders, isLoading } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(id, product_name, quantity, unit_price)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const { error } = await supabase.from("orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Order updated");
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="animate-rise space-y-5">
      <div>
        <h1 className="gold-text font-display text-3xl">Orders</h1>
        <p className="text-sm text-muted-foreground">Fulfilment and payment status.</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading orders…</p>}

      <div className="space-y-3">
        {(orders ?? []).map((o) => (
          <Card key={o.id} className="glass-panel">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg">{o.customer_name}</p>
                  <p className="text-[0.7rem] tracking-wider text-muted-foreground uppercase">
                    #{o.order_number} · {shortDate(o.created_at)} · {o.customer_phone ?? "no phone"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="uppercase">
                    {o.payment_method}
                  </Badge>
                  <span className="text-gold">{inr(o.total)}</span>
                </div>
              </div>

              <div className="space-y-1">
                {(o.order_items ?? []).map((it) => (
                  <div
                    key={it.id}
                    className="flex justify-between rounded-lg bg-secondary/60 px-3 py-2 text-sm"
                  >
                    <span className="truncate">
                      {it.product_name} × {it.quantity}
                    </span>
                    <span className="text-muted-foreground">{inr(it.unit_price)}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Status</span>
                <Select
                  value={o.status}
                  onValueChange={(v) => setStatus.mutate({ id: o.id, status: v as Status })}
                >
                  <SelectTrigger className="w-44 capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && (orders ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">No orders yet.</p>
      )}
    </div>
  );
}
