import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { inr } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/rates")({
  head: () => ({
    meta: [
      { title: "Metal Rates — Ratan Jewellers Admin" },
      { name: "description", content: "Update today's live gold and silver rates per gram." },
      { property: "og:title", content: "Metal Rates — Ratan Jewellers Admin" },
      { property: "og:description", content: "Update today's live gold and silver rates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RatesPage,
});

function RatesPage() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data: rates, isLoading } = useQuery({
    queryKey: ["admin-rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metal_rates")
        .select("*")
        .order("metal")
        .order("purity");
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, rate }: { id: string; rate: number }) => {
      const { error } = await supabase
        .from("metal_rates")
        .update({ rate_per_gram: rate })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rate updated");
      queryClient.invalidateQueries({ queryKey: ["admin-rates"] });
      queryClient.invalidateQueries({ queryKey: ["public-rates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="animate-rise space-y-5">
      <div>
        <h1 className="gold-text font-display text-3xl">Live rates</h1>
        <p className="text-sm text-muted-foreground">
          Today&apos;s metal rates shown across the storefront.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading rates…</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(rates ?? []).map((r) => {
          const draft = drafts[r.id] ?? String(r.rate_per_gram);
          return (
            <Card key={r.id} className="glass-panel">
              <CardContent className="space-y-3 p-4">
                <div>
                  <p className="font-display text-xl capitalize">
                    {r.metal} {r.purity}
                  </p>
                  <p className="text-[0.7rem] tracking-wider text-muted-foreground uppercase">
                    Current {inr(r.rate_per_gram)} / gram
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`rate-${r.id}`}>New rate per gram</Label>
                  <div className="flex gap-2">
                    <Input
                      id={`rate-${r.id}`}
                      type="number"
                      step="0.01"
                      value={draft}
                      onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
                    />
                    <Button
                      onClick={() => {
                        const value = Number(draft);
                        if (!Number.isFinite(value) || value <= 0) {
                          toast.error("Enter a valid rate");
                          return;
                        }
                        update.mutate({ id: r.id, rate: value });
                      }}
                      disabled={update.isPending}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
