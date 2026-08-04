import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRbAuth } from "@/components/rb/RbAuthContext";
import { LogOut, MoreHorizontal, Phone, Building2, Landmark, ChevronRight } from "lucide-react";
import { fetchOtherFirms } from "@/lib/rb-firms.functions";

export const Route = createFileRoute("/_app/more")({
  head: () => ({
    meta: [
      { title: "More — Ratan Bullion" },
      { name: "description", content: "Settings, profile and additional options." },
    ],
  }),
  component: MorePage,
});

function MorePage() {
  const auth = useRbAuth();

  const fetchFirms = useServerFn(fetchOtherFirms);
  const settingsQ = useQuery({
    queryKey: ["rb", "app_settings", "other_firms"],
    queryFn: () => fetchFirms(),
  });
  const s = settingsQ.data ?? {};
  const firms = [
    {
      name: s.firm2_name,
      type: s.firm2_business_type,
      phone: s.firm2_phone,
    },
    {
      name: s.firm3_name,
      type: s.firm3_business_type,
      phone: s.firm3_phone,
    },
  ].filter(
    (f) =>
      (f.name || "").trim() ||
      (f.phone || "").trim() ||
      (f.type || "").trim(),
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 text-foreground">
        <MoreHorizontal className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">More</h2>
      </header>

      <section className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Profile</p>
        <p className="mt-1 text-sm text-card-foreground">{auth.name || "—"}</p>
        <p className="text-xs text-muted-foreground">{auth.mobile || "—"}</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-2">
        <Link
          to="/bank"
          className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-3 text-sm text-foreground hover:bg-muted"
        >
          <span className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" /> Bank Details
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </section>

      {firms.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Building2 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Other Firms</h3>
          </div>
          <div className="space-y-2">
            {firms.map((f, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {f.name || "—"}
                  </p>
                  {f.type && (
                    <p className="text-[11px] text-muted-foreground truncate">{f.type}</p>
                  )}
                  {f.phone && (
                    <p className="text-xs text-foreground mt-0.5">{f.phone}</p>
                  )}
                </div>
                {f.phone && (
                  <a
                    href={`tel:${f.phone.replace(/[^\d+]/g, "")}`}
                    aria-label={`Call ${f.name || "firm"}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow hover:brightness-110"
                  >
                    <Phone className="h-4 w-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-2">
        <button
          onClick={() => auth.signOut()}
          className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-3 text-sm text-foreground hover:bg-muted"
        >
          <span className="flex items-center gap-2"><LogOut className="h-4 w-4" /> Sign out</span>
        </button>
      </section>
    </div>
  );
}
