import { useState } from "react";
import { useRbAuth } from "./RbAuthContext";
import { normalizeMobile } from "@/lib/rb-device";
import { registerCustomer, registerDevice } from "@/lib/rb-auth";
import { Loader2, Phone, ShieldCheck, ArrowRight } from "lucide-react";
import { BrandLogo, BrandWordmark } from "./BrandMark";

type Stage =
  | { kind: "mobile" }
  | { kind: "register"; mobile: string }
  | { kind: "error"; mobile: string; message: string };

export function LoginScreen() {
  const auth = useRbAuth();
  const [stage, setStage] = useState<Stage>({ kind: "mobile" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form fields
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");

  // Hidden admin shortcut: 5 taps on the brand logo within 2.5s opens /admin.
  const [logoTaps, setLogoTaps] = useState(0);
  function handleLogoTap() {
    setLogoTaps((n) => {
      const next = n + 1;
      if (next >= 5) {
        if (typeof window !== "undefined") window.location.href = "/admin";
        return 0;
      }
      return next;
    });
    window.setTimeout(() => setLogoTaps(0), 2500);
  }

  async function submitMobile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const m = normalizeMobile(mobile);
    if (m.length !== 10) {
      setError("Please enter valid 10 digit mobile number");
      return;
    }
    setBusy(true);
    try {
      const res = await auth.setMobileAndRefresh(m);
      if (res.access === "no_customer") {
        setStage({ kind: "register", mobile: m });
      } else if (res.access === "device_unregistered") {
        // Auto-register the device, then let the app shell render
        // (user lands on Live Rate with public market rates).
        try {
          await registerDevice(m);
          await auth.refresh();
        } catch (err) {
          console.error("[LoginScreen] auto device register failed", err);
        }
        return;
      } else if (res.access === "error") {
        setStage({ kind: "error", mobile: m, message: "Unable to connect. Please try again." });
      }
      // granted / pending_approval / device_pending → AppGate renders the app shell.
      return;
    } catch (err) {
      setStage({
        kind: "error",
        mobile: m,
        message: "Unable to connect. Please try again.",
      });
      console.error("[LoginScreen] submitMobile error", err);
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (stage.kind !== "register") return;
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    try {
      const r = await registerCustomer({
        mobile: stage.mobile,
        name: name.trim(),
        city: city.trim() || undefined,
      });
      if (!r.ok) throw new Error(r.error ?? "Registration failed");
      await registerDevice(stage.mobile, name.trim());
      auth.setName(name.trim());
      // Refresh so AppGate transitions out of LoginScreen into the app shell
      // (with pending_approval / device_pending gated to public market rates).
      await auth.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <main className="flex-1 flex items-center justify-center p-5">
        <div className="w-full max-w-sm">
        {/* Brand block (old style) */}
        <div className="flex flex-col items-center text-center mb-7">
          <BrandLogo size="xl" className="mb-5" onClick={handleLogoTap} />
          <BrandWordmark size="lg" />
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <ShieldCheck className="w-3 h-3 text-gold" />
            <span>Mobile-based access</span>
          </div>
        </div>

        <div className="bg-card border border-gold/25 rounded-2xl p-5 shadow-card">

        {stage.kind === "mobile" && (
          <form onSubmit={submitMobile} className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Mobile number</label>
              <div className="relative mt-1.5">
                <Phone className="w-4 h-4 text-gold/50 absolute right-4 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="tel"
                  maxLength={10}
                  autoFocus
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="Enter 10 digit mobile number"
                  className="w-full pl-4 pr-10 py-3 bg-input border border-border rounded-xl text-base font-mono tracking-wider focus:border-gold focus:outline-none transition"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3.5 gradient-gold text-primary-foreground font-bold rounded-xl shadow-gold disabled:opacity-60 transition active:scale-[0.98] uppercase tracking-wider text-sm flex items-center justify-center gap-2 mt-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (<>Continue <ArrowRight className="w-4 h-4" /></>)}
            </button>
            <p className="text-center text-[10px] text-muted-foreground leading-relaxed pt-1">
              Approved dealer clients see live buy/sell rates and booking desk.<br />
              Others see the public market view.
            </p>
            <ErrorLine error={error} />
          </form>
        )}

        {stage.kind === "register" && (
          <form onSubmit={submitRegister} className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              New number <span className="text-gold font-semibold">{stage.mobile}</span> — please enter your name and city.
            </p>
            <Field label="Name *">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="City">
              <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
            </Field>
            <Submit busy={busy}>Submit for approval</Submit>
            <ErrorLine error={error} />
          </form>
        )}

        {stage.kind === "error" && (
          <StatusCard
            title="Connection problem"
            body={stage.message}
            action={
              <button
                onClick={async () => {
                  setError(null);
                  setBusy(true);
                  try {
                    const res = await auth.setMobileAndRefresh(stage.mobile);
                    if (res.access === "no_customer")
                      setStage({ kind: "register", mobile: stage.mobile });
                    else if (res.access === "error")
                      setStage({
                        kind: "error",
                        mobile: stage.mobile,
                        message: "Unable to connect. Please try again.",
                      });
                    // Other access states → AppGate renders the app shell.
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
                className={primaryBtn}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Retry"}
              </button>
            }
          />
        )}

        {stage.kind !== "mobile" && (
          <button
            onClick={() => {
              setStage({ kind: "mobile" });
              setError(null);
              auth.signOut();
            }}
            className="mt-4 text-xs text-muted-foreground underline w-full text-center"
          >
            Use a different mobile
          </button>
        )}
        </div>
        <p className="text-center text-[10px] text-muted-foreground mt-5 leading-relaxed">
          Call to activate dealer access · <span className="text-gold font-semibold">7014002852</span>
        </p>
        </div>
      </main>
    </div>
  );
}

const inputClass =
  "w-full px-3 py-3 bg-input border border-border rounded-xl text-sm focus:border-gold focus:outline-none transition";
const primaryBtn =
  "w-full py-3.5 gradient-gold text-primary-foreground font-bold rounded-xl shadow-gold disabled:opacity-60 transition active:scale-[0.98] uppercase tracking-wider text-sm flex items-center justify-center gap-2";

function FieldLabel({ children }: { children: ReactNodeLike }) {
  return <label className="block text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-1.5">{children}</label>;
}
function Field({ label, children }: { label: string; children: ReactNodeLike }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}
function Submit({ busy, children }: { busy: boolean; children: ReactNodeLike }) {
  return (
    <button type="submit" disabled={busy} className={primaryBtn}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}
function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-destructive">{error}</p>;
}
function StatusCard({
  title,
  body,
  action,
  error,
}: {
  title: string;
  body: string;
  action?: ReactNodeLike;
  error?: string | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <h3 className="text-lg font-semibold text-primary">{title}</h3>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action}
      <ErrorLine error={error ?? null} />
    </div>
  );
}

type ReactNodeLike = React.ReactNode;