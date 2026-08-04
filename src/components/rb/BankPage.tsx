import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Copy, Check, MessageCircle } from "lucide-react";
import { fetchActiveBanks, type BankRow } from "@/lib/rb-bank";
import { fetchMarketSettings } from "@/lib/rb-rates";
import { rbSupabase } from "@/integrations/rb-supabase/client";

function digitsOnly(s: string | null | undefined) {
  return (s ?? "").replace(/\D/g, "");
}

function waPhone(s: string | null | undefined) {
  const d = digitsOnly(s);
  if (!d) return "";
  if (d.length === 10) return "91" + d;
  return d;
}

function CopyButton({ text }: { text: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background/70 px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-background hover:text-primary"
      aria-label="Copy"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-green-500" />
          <span className="text-green-500">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

function DetailRow({
  label,
  value,
  copy,
}: {
  label: string;
  value: string | null | undefined;
  copy?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground shrink-0">
        {label}
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate text-sm font-semibold text-foreground text-right">{value}</p>
        {copy && <CopyButton text={value} />}
      </div>
    </div>
  );
}

function BankCard({ b }: { b: BankRow }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <header className="flex items-center justify-between gap-2 pb-3 border-b border-border">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-wide text-primary">
            {b.bank_name || "Bank Account"}
          </h3>
          {b.account_name && (
            <p className="truncate text-[11px] text-muted-foreground mt-0.5">{b.account_name}</p>
          )}
        </div>
        {b.label && (
          <span className="shrink-0 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary">
            {b.label}
          </span>
        )}
      </header>

      <div className="mt-1 divide-y divide-border/60">
        <DetailRow label="Account Name" value={b.account_name} />
        <DetailRow label="Account Number" value={b.account_no} copy />
        <DetailRow label="IFSC" value={b.ifsc} copy />
        <DetailRow label="Branch" value={b.branch} />
      </div>
    </article>
  );
}

function WhatsAppScreenshotButton({ phone }: { phone: string }) {
  const msg = encodeURIComponent(
    "Payment screenshot attached. Please verify my payment.",
  );
  const href = `https://wa.me/${phone}?text=${msg}`;
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
      >
        <MessageCircle className="h-4 w-4" />
        Send Screenshot on WhatsApp
      </a>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Please attach your payment screenshot and send it on WhatsApp.
      </p>
    </div>
  );
}

export function BankPage() {
  const qc = useQueryClient();
  const banksQ = useQuery({
    queryKey: ["rb", "bank_settings", "active"],
    queryFn: fetchActiveBanks,
    refetchInterval: 120_000,
  });
  const settingsQ = useQuery({
    queryKey: ["rb", "market_settings"],
    queryFn: fetchMarketSettings,
    refetchInterval: 30_000,
  });

  // Realtime: refetch market settings (incl. whatsapp_phone) immediately
  // when admin updates app_settings.
  useEffect(() => {
    const channel = rbSupabase
      .channel("rb-bank-settings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        () => {
          qc.invalidateQueries({ queryKey: ["rb", "market_settings"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bank_settings" },
        () => {
          qc.invalidateQueries({ queryKey: ["rb", "bank_settings", "active"] });
        },
      )
      .subscribe();
    return () => {
      rbSupabase.removeChannel(channel);
    };
  }, [qc]);

  const banks = banksQ.data ?? [];
  const settings = settingsQ.data ?? {};
  // WhatsApp icon must use ONLY app_settings.whatsapp_phone.
  const wa = waPhone(settings.whatsapp_phone);

  return (
    <section className="space-y-4 pb-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-primary/80">Ratan Bullion</p>
        <h2 className="text-2xl font-semibold mt-1">Bank Details</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Tap copy to use any detail.
        </p>
      </div>

      {banksQ.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : banksQ.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-card p-5 text-sm text-destructive">
          Failed to load bank details. {(banksQ.error as Error).message}
        </div>
      ) : banks.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Bank details will be updated soon.
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {banks.map((b) => (
              <BankCard key={b.id} b={b} />
            ))}
          </div>

          {wa && <WhatsAppScreenshotButton phone={wa} />}
        </>
      )}
    </section>
  );
}
