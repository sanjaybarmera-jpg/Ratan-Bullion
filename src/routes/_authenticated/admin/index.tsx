import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { inr, shortDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, ReceiptText, Users, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Ratan Jewellers Admin" },
      { name: "description", content: "Sales, orders and inventory overview for Ratan Jewellers." },
      { property: "og:title", content: "Dashboard — Ratan Jewellers Admin" },
      { property: "og:description", content: "Sales, orders and inventory overview." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => {
      const [products, orders, customers, rates] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }),
        supabase
          .from("orders")
          .select("id, order_number, customer_name, status, total, created_at")
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("metal_rates").select("metal, purity, rate_per_gram"),
      ]);
      if (orders.error) throw orders.error;
      return {
        productCount: products.count ?? 0,
        customerCount: customers.count ?? 0,
        orders: orders.data ?? [],
        rates: rates.data ?? [],
      };
    },
  });

  const revenue = (data?.orders ?? [])
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + Number(o.total), 0);

  const stats = [
    { label: "Revenue", value: inr(revenue), icon: TrendingUp },
    { label: "Orders", value: String(data?.orders.length ?? 0), icon: ReceiptText },
    { label: "Products", value: String(data?.productCount ?? 0), icon: Package },
    { label: "Customers", value: String(data?.customerCount ?? 0), icon: Users },
  ];

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="gold-text font-display text-3xl">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Store performance at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="glass-panel">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-[0.65rem] tracking-widest text-muted-foreground uppercase">
                  {s.label}
                </p>
                <s.icon className="h-4 w-4 text-gold" />
              </div>
              <p className="mt-2 font-display text-2xl">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass-panel lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="font-display text-xl">Recent orders</CardTitle>
            <Link to="/admin/orders" className="text-xs text-gold underline underline-offset-4">
              View all
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.orders ?? []).slice(0, 6).map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{o.customer_name}</p>
                  <p className="text-[0.7rem] text-muted-foreground">
                    #{o.order_number} · {shortDate(o.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="outline" className="capitalize">
                    {o.status}
                  </Badge>
                  <span className="text-sm text-gold">{inr(o.total)}</span>
                </div>
              </div>
            ))}
            {data?.orders.length === 0 && (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="font-display text-xl">Live rates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.rates ?? []).map((r) => (
              <div
                key={`${r.metal}-${r.purity}`}
                className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2.5 text-sm"
              >
                <span className="capitalize">
                  {r.metal} {r.purity}
                </span>
                <span className="text-gold">{inr(r.rate_per_gram)}/g</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
