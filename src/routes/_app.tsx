import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { LineChart, ClipboardList, Gem, MoreHorizontal, Phone, CandlestickChart } from "lucide-react";
import { RbAuthProvider, useRbAuth } from "@/components/rb/RbAuthContext";
import { LoginScreen } from "@/components/rb/LoginScreen";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketSettings } from "@/lib/rb-rates";
import { getMcxMarketStatus } from "@/lib/mcx-market-status";
import { Toaster } from "@/components/ui/sonner";
import { BrandLogo } from "@/components/rb/BrandMark";

export const Route = createFileRoute("/_app")({
  component: () => (
    <RbAuthProvider>
      <AppGate />
    </RbAuthProvider>
  ),
});

const navItems = [
  { to: "/", label: "Live Rate", icon: LineChart },
  { to: "/terminal", label: "Terminal", icon: CandlestickChart },
  { to: "/orders", label: "Orders", icon: ClipboardList },
  { to: "/jewellery", label: "Jewellery", icon: Gem },
  { to: "/more", label: "More", icon: MoreHorizontal },
] as const;

function AppGate() {
  const auth = useRbAuth();

  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!auth.mobile) {
    return <LoginScreen />;
  }

  // For no_customer (new mobile that hasn't registered yet), show LoginScreen
  // so they can complete the registration form. After register, access becomes
  // pending_approval and they enter the app shell.
  if (auth.access === "no_customer") {
    return <LoginScreen />;
  }

  return <AppLayout />;
}

function AppLayout() {
  const auth = useRbAuth();
  const marketQ = useQuery({
    queryKey: ["rb", "app_settings", "market"],
    queryFn: fetchMarketSettings,
    refetchInterval: 120_000,
  });
  const dealerPhone =
    marketQ.data?.dealer_phone?.trim() || marketQ.data?.contact_phone?.trim() || "";

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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
  const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const mcx = getMcxMarketStatus(now);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="min-h-screen flex flex-col w-full max-w-md md:max-w-7xl mx-auto relative">
        <header className="sticky top-0 z-40 bg-gradient-to-b from-background via-background/95 to-background/80 backdrop-blur-xl border-b border-gold/20">
          <div className="flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <BrandLogo size="sm" onClick={handleLogoTap} />
              <div className="min-w-0">
                <div className="font-display text-base text-gradient-gold leading-none tracking-[0.08em]" style={{ fontWeight: 600 }}>
                  Ratan Bullion
                </div>
                <p className="text-[9px] tracking-[0.22em] text-muted-foreground uppercase mt-1 truncate">
                  Namaste, {auth.name ?? (auth.mobile ? `Guest ${auth.mobile.slice(-4)}` : "Guest")}
                  <span className="ml-1.5 text-gold">· Dealer</span>
                </p>
              </div>
            </div>

            {/* Desktop / tablet top navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  activeOptions={{ exact: true }}
                  activeProps={{
                    className:
                      "flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-b from-gold/20 to-gold/5 text-gold text-xs font-semibold uppercase tracking-wide transition",
                  }}
                  inactiveProps={{
                    className:
                      "flex items-center gap-1.5 px-3 py-2 rounded-xl text-muted-foreground hover:text-foreground text-xs font-semibold uppercase tracking-wide transition",
                  }}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-1.5 shrink-0">
              {dealerPhone && (
                <a
                  href={`tel:${dealerPhone}`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-gold/10 border border-gold/40 text-gold text-xs font-semibold active:scale-95 transition"
                >
                  <Phone className="w-3.5 h-3.5" /> Call
                </a>
              )}
            </div>
          </div>
          <div className="px-4 sm:px-6 lg:px-8 pb-2 flex items-center gap-2 text-[10px]">
            <span className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  mcx.isOpen ? "bg-bull animate-pulse-gold" : "bg-bear"
                }`}
              />
              <span
                className={`uppercase tracking-[0.18em] font-semibold ${
                  mcx.isOpen ? "text-bull" : "text-bear"
                }`}
              >
                {mcx.label}
              </span>
            </span>
            <span className="ml-auto font-mono text-muted-foreground">
              {dateStr} · {timeStr}
            </span>
          </div>
        </header>

        <main className="flex-1 w-full pb-28 md:pb-10 px-4 sm:px-6 lg:px-8 pt-3">
          <Outlet />
        </main>

        <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden">
          <div className="max-w-md mx-auto px-3 pb-3">
            <div
              className="bg-card/95 backdrop-blur-xl border border-gold/30 rounded-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.6)] grid p-1.5"
              style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
            >
              {navItems.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  activeOptions={{ exact: true }}
                  activeProps={{
                    className:
                      "flex flex-col items-center gap-1 py-2 rounded-xl bg-gradient-to-b from-gold/20 to-gold/5 text-gold transition",
                  }}
                  inactiveProps={{
                    className:
                      "flex flex-col items-center gap-1 py-2 rounded-xl text-muted-foreground hover:text-foreground transition",
                  }}
                >
                  <Icon className="w-[18px] h-[18px]" />
                  <span className="text-[9px] font-semibold tracking-wide uppercase">{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </nav>
      </div>
      <Toaster />
    </div>
  );
}
