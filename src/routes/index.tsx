import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { inr } from "@/lib/format";
import { Gem, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ratan Jewellers — Fine Gold, Diamond & Bridal Jewellery" },
      {
        name: "description",
        content:
          "Ratan Jewellers: handcrafted gold, silver and diamond jewellery with live daily rates and transparent making charges.",
      },
      { property: "og:title", content: "Ratan Jewellers — Fine Jewellery" },
      {
        property: "og:description",
        content: "Handcrafted gold, silver and diamond jewellery with live daily rates.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { data: rates } = useQuery({
    queryKey: ["public-rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metal_rates")
        .select("metal, purity, rate_per_gram")
        .order("rate_per_gram", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-5 py-5 sm:px-10">
        <div className="flex items-center gap-2">
          <Gem className="h-5 w-5 text-gold" />
          <span className="font-display text-lg tracking-wide">Ratan Jewellers</span>
        </div>
        <Link
          to="/admin"
          className="rounded-full border border-gold/40 px-4 py-2 text-xs font-medium tracking-widest text-gold uppercase transition-colors hover:bg-gold hover:text-gold-foreground"
        >
          Admin
        </Link>
      </header>

      <section className="animate-rise mx-auto max-w-3xl px-5 pt-16 pb-10 text-center sm:pt-24">
        <p className="text-xs tracking-[0.35em] text-muted-foreground uppercase">Since 1974</p>
        <h1 className="gold-text mt-5 font-display text-5xl leading-tight sm:text-7xl">
          Heirlooms in the making
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
          Hand-finished gold, silver and diamond jewellery — priced transparently against the day&apos;s
          live metal rates.
        </p>
        <Link
          to="/admin"
          className="mt-9 inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:scale-105"
        >
          Open admin panel <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <section className="mx-auto max-w-3xl px-5 pb-24">
        <h2 className="mb-4 text-center text-xs tracking-[0.3em] text-muted-foreground uppercase">
          Today&apos;s rates
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(rates ?? []).map((r) => (
            <div key={`${r.metal}-${r.purity}`} className="glass-panel rounded-2xl p-4 text-center">
              <p className="text-[0.65rem] tracking-widest text-muted-foreground uppercase">
                {r.metal} {r.purity}
              </p>
              <p className="mt-1 font-display text-xl text-gold">{inr(r.rate_per_gram)}</p>
              <p className="text-[0.65rem] text-muted-foreground">per gram</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
