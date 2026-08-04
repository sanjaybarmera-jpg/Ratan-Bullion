import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RB_BROWSER_URL } from "@/integrations/rb-supabase/client";
import { getServerAudit } from "@/lib/audit.functions";

const EXPECTED_REF = "tbgqovfgtuilgdtrmaxe";

function refFromUrl(u: string): string {
  try {
    return new URL(u).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
}

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Supabase Connection Audit — Ratan Bullion" },
      { name: "description", content: "Verify that all Ratan Bullion Supabase clients target the correct project." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuditPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">Audit failed to load</h1>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function Row({
  label,
  url,
  ref,
  extra,
}: {
  label: string;
  url: string;
  ref: string;
  extra?: React.ReactNode;
}) {
  const ok = ref === EXPECTED_REF;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-card-foreground">{label}</h3>
        <span
          className={
            "rounded-full px-2.5 py-0.5 text-xs font-medium " +
            (ok
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/15 text-destructive")
          }
        >
          {ok ? "OK" : "MISMATCH"}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-1 text-sm">
        <dt className="text-muted-foreground">URL</dt>
        <dd className="font-mono break-all">{url || <em className="text-destructive">missing</em>}</dd>
        <dt className="text-muted-foreground">Project ref</dt>
        <dd className="font-mono">{ref || <em className="text-destructive">missing</em>}</dd>
      </dl>
      {extra ? <div className="mt-2 text-sm text-muted-foreground">{extra}</div> : null}
    </div>
  );
}

function AuditPage() {
  // SECURITY: this page reveals Supabase project URLs and service-role
  // presence. Gate it behind the admin token in localStorage; un-authenticated
  // visitors get a generic not-found view instead of the audit data.
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  useEffect(() => {
    try {
      const t = window.localStorage.getItem("rb_admin_token");
      setHasToken(!!t);
    } catch {}
    setReady(true);
  }, []);
  const auditFn = useServerFn(getServerAudit);
  const { data, isLoading, error } = useQuery({
    queryKey: ["rb-audit"],
    queryFn: () => auditFn(),
    enabled: hasToken,
  });

  if (!ready) return null;
  if (!hasToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <p className="text-sm">Not found.</p>
      </div>
    );
  }

  const browserUrl = RB_BROWSER_URL;
  const browserRef = refFromUrl(browserUrl);

  const allOk =
    browserRef === EXPECTED_REF &&
    data?.serverRef === EXPECTED_REF &&
    data?.adminRef === EXPECTED_REF &&
    data?.hasServiceRole === true;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Ratan Bullion</p>
          <h1 className="mt-1 text-3xl font-semibold">Supabase Connection Audit</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Expected project ref:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{EXPECTED_REF}</code>
          </p>
        </header>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Running audit…</p>
        ) : error ? (
          <p className="text-sm text-destructive">Failed to read server audit: {(error as Error).message}</p>
        ) : (
          <div className="space-y-4">
            <Row label="1. Browser client" url={browserUrl} ref={browserRef} />
            <Row label="2. Server function client" url={data!.serverUrl} ref={data!.serverRef} />
            <Row
              label="3. Admin client"
              url={data!.adminUrl}
              ref={data!.adminRef}
              extra={
                <>
                  Service role key present:{" "}
                  <span className={data!.hasServiceRole ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                    {data!.hasServiceRole ? "yes" : "no"}
                  </span>
                </>
              }
            />

            <div
              className={
                "mt-6 rounded-lg border p-4 text-sm " +
                (allOk
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                  : "border-destructive/30 bg-destructive/5 text-destructive")
              }
            >
              {allOk
                ? "All three clients are bound to the correct project. Safe to proceed with the full build."
                : "One or more clients do not match the expected project ref. Do not proceed until this is resolved."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}