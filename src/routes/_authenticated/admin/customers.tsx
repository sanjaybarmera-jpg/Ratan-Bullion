import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { shortDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Ratan Jewellers Admin" },
      { name: "description", content: "View registered customers and their store roles." },
      { property: "og:title", content: "Customers — Ratan Jewellers Admin" },
      { property: "og:description", content: "View registered customers and their roles." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CustomersPage,
});

function CustomersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-customers"],
    queryFn: async () => {
      const [profiles, roles] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (profiles.error) throw profiles.error;
      const roleMap = new Map<string, string[]>();
      for (const r of roles.data ?? []) {
        roleMap.set(r.user_id, [...(roleMap.get(r.user_id) ?? []), r.role]);
      }
      return (profiles.data ?? []).map((p) => ({ ...p, roles: roleMap.get(p.id) ?? [] }));
    },
  });

  return (
    <div className="animate-rise space-y-5">
      <div>
        <h1 className="gold-text font-display text-3xl">Customers</h1>
        <p className="text-sm text-muted-foreground">Everyone registered with the store.</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading customers…</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((c) => (
          <Card key={c.id} className="glass-panel">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary">
                <UserRound className="h-5 w-5 text-gold" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{c.full_name ?? "Unnamed customer"}</p>
                <p className="text-[0.7rem] text-muted-foreground">
                  {c.phone ?? "No phone"} · joined {shortDate(c.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {c.roles.map((r) => (
                  <Badge key={r} variant="outline" className="capitalize">
                    {r}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && (data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">No customers registered yet.</p>
      )}
    </div>
  );
}
