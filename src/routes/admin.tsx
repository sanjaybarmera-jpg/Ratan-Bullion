import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Loader2, LogOut, ShieldCheck, Smartphone, Users, LineChart, Landmark, Newspaper, ClipboardList, Gem, Settings as SettingsIcon, Search, Crown, ChevronDown, ChevronRight, Menu, X, Moon, Sun } from "lucide-react";
import { useAdminTheme } from "@/hooks/use-admin-theme";
import {
  adminListCustomers,
  adminListDevices,
  adminLogin,
  adminLogout,
  adminSetCustomerActive,
  adminSetCustomerVip,
  adminSetDeviceApproved,
} from "@/lib/rb-admin.functions";
import { RatesTab } from "@/components/rb/admin/RatesTab";
import { BankTab } from "@/components/rb/admin/BankTab";
import { NewsTab } from "@/components/rb/admin/NewsTab";
import { OrdersTab } from "@/components/rb/admin/OrdersTab";
import { SettingsTab } from "@/components/rb/admin/SettingsTab";
import { JewelleryTab } from "@/components/rb/admin/JewelleryTab";

const TOKEN_KEY = "rb_admin_token";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (t) window.localStorage.setItem(TOKEN_KEY, t);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Ratan Bullion" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center space-y-3">
          <h1 className="text-xl font-semibold text-foreground">Admin error</h1>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >Try again</button>
        </div>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function AdminPage() {
  const [token, setTok] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setTok(getToken()); setReady(true); }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!token) {
    return <AdminLogin onLogin={(t) => { setToken(t); setTok(t); }} />;
  }
  return <AdminDashboard token={token} onLogout={() => { setToken(null); setTok(null); }} />;
}

function AdminLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const loginFn = useServerFn(adminLogin);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await loginFn({ data: { username: "admin", pin } });
      if (!res.ok || !res.token) {
        setErr(res.error || "Invalid credentials");
        return;
      }
      onLogin(res.token);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-5">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold text-card-foreground">Admin Login</h1>
        </div>
        <label className="block text-xs text-muted-foreground mb-1">PIN / Password</label>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground tracking-widest"
        />
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        <button
          type="submit"
          disabled={busy || !pin}
          className="mt-5 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Login"}
        </button>
      </form>
    </div>
  );
}

type Customer = {
  id: string;
  name: string | null;
  mobile: string | null;
  city: string | null;
  firm_name: string | null;
  gst_no: string | null;
  is_active: boolean | null;
  is_vip: boolean | null;
  created_at: string | null;
};

type DeviceRow = {
  id: string;
  customer_id?: string | null;
  device_id?: string | null;
  device_name?: string | null;
  user_agent?: string | null;
  is_approved?: boolean | null;
  created_at?: string | null;
} & Record<string, unknown>;

function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const logoutFn = useServerFn(adminLogout);
  const listCustomersFn = useServerFn(adminListCustomers);
  const listDevicesFn = useServerFn(adminListDevices);
  const setActiveFn = useServerFn(adminSetCustomerActive);
  const setVipFn = useServerFn(adminSetCustomerVip);
  const setApprovedFn = useServerFn(adminSetDeviceApproved);

  type Tab = "customers" | "rates" | "bank" | "news" | "orders" | "jewellery" | "settings";
  const [tab, setTab] = useState<Tab>("customers");

  const customersQ = useQuery({
    queryKey: ["admin-customers"],
    queryFn: async () => {
      const r: any = await listCustomersFn({ data: { token } });
      if (r?.unauthorized) { onLogout(); throw new Error("Session expired. Please log in again."); }
      return r;
    },
    enabled: tab === "customers",
    refetchInterval: tab === "customers" ? 5000 : false,
    refetchOnWindowFocus: true,
  });
  const devicesQ = useQuery({
    queryKey: ["admin-devices"],
    queryFn: async () => {
      const r: any = await listDevicesFn({ data: { token } });
      if (r?.unauthorized) { onLogout(); throw new Error("Session expired. Please log in again."); }
      return r;
    },
    enabled: tab === "customers",
    refetchInterval: tab === "customers" ? 5000 : false,
    refetchOnWindowFocus: true,
  });

  const setActive = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      setActiveFn({ data: { token, ...v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-customers"] }),
  });
  const setVip = useMutation({
    mutationFn: (v: { id: string; vip: boolean }) =>
      setVipFn({ data: { token, ...v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-customers"] }),
  });
  const setApproved = useMutation({
    mutationFn: (v: { id: string; approved: boolean }) =>
      setApprovedFn({ data: { token, ...v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-devices"] }),
  });

  async function handleLogout() {
    try { await logoutFn({ data: { token } }); } catch {}
    onLogout();
    router.navigate({ to: "/" });
  }

  const { theme, toggle, themeClass } = useAdminTheme();
  const [navOpen, setNavOpen] = useState(false);

  const NAV: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: "customers", label: "Customers", icon: Users },
    { key: "rates", label: "Rates", icon: LineChart },
    { key: "orders", label: "Orders", icon: ClipboardList },
    { key: "bank", label: "Bank", icon: Landmark },
    { key: "news", label: "News", icon: Newspaper },
    { key: "jewellery", label: "Jewellery", icon: Gem },
    { key: "settings", label: "Settings", icon: SettingsIcon },
  ];

  const activeLabel = NAV.find((n) => n.key === tab)?.label ?? "Admin";

  const navList = (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map((n) => (
        <NavBtn
          key={n.key}
          active={tab === n.key}
          onClick={() => { setTab(n.key); setNavOpen(false); }}
          icon={n.icon}
          label={n.label}
        />
      ))}
    </nav>
  );

  return (
    <div className={`min-h-screen bg-background text-foreground ${themeClass}`}>
      <div className="flex min-h-screen w-full">
        {/* Fixed sidebar — desktop */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-4">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-primary">Ratan Bullion</p>
              <p className="truncate text-[11px] text-muted-foreground">Admin CMS</p>
            </div>
          </div>
          {navList}
          <div className="mt-auto p-3">
            <button
              onClick={handleLogout}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" /> Logout
            </button>
          </div>
        </aside>

        {/* Mobile / tablet drawer */}
        {navOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              aria-label="Close menu"
              onClick={() => setNavOpen(false)}
              className="absolute inset-0 bg-black/50"
            />
            <div className="absolute inset-y-0 left-0 w-64 border-r border-border bg-card shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-4 py-4">
                <span className="text-sm font-semibold text-primary">Admin CMS</span>
                <button onClick={() => setNavOpen(false)} className="text-muted-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {navList}
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
              <button
                onClick={() => setNavOpen(true)}
                className="rounded-md border border-border p-1.5 text-muted-foreground lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground sm:text-base">
                {activeLabel}
              </h1>
              <button
                onClick={toggle}
                aria-label="Toggle theme"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {theme === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{theme === "dark" ? "Dark" : "Light"}</span>
              </button>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground lg:hidden"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 sm:px-6 lg:px-8 lg:py-6 space-y-3">
            {tab === "customers" ? (
              <CustomersPanel
                customers={(customersQ.data?.customers ?? []) as Customer[]}
                devices={(devicesQ.data?.devices ?? []) as DeviceRow[]}
                loading={customersQ.isLoading || devicesQ.isLoading}
                error={(customersQ.error as Error | null) ?? (devicesQ.error as Error | null) ?? null}
                onToggleActive={(id, active) => setActive.mutate({ id, active })}
                onToggleVip={(id, vip) => setVip.mutate({ id, vip })}
                onToggleDevice={(id, approved) => setApproved.mutate({ id, approved })}
                busy={setActive.isPending || setVip.isPending || setApproved.isPending}
              />
            ) : tab === "rates" ? (
              <RatesTab token={token} onUnauthorized={onLogout} />
            ) : tab === "orders" ? (
              <OrdersTab token={token} onUnauthorized={onLogout} />
            ) : tab === "bank" ? (
              <BankTab token={token} onUnauthorized={onLogout} />
            ) : tab === "news" ? (
              <NewsTab token={token} onUnauthorized={onLogout} />
            ) : tab === "jewellery" ? (
              <JewelleryTab token={token} onUnauthorized={onLogout} />
            ) : (
              <SettingsTab token={token} onUnauthorized={onLogout} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center py-10">{children}</div>;
}

function NavBtn({
  active, onClick, icon: Icon, label,
}: { active: boolean; onClick: () => void; icon: typeof Users; label: string }) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium border transition " +
        (active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground")
      }
    >
      <Icon className="h-4 w-4 shrink-0" /> {label}
    </button>
  );
}


type Filter = "all" | "pending" | "approved" | "vip" | "device_pending";

function Switch({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 " +
        (on ? "bg-primary" : "bg-muted")
      }
      aria-pressed={on}
    >
      <span
        className={
          "absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition " +
          (on ? "left-[18px]" : "left-0.5")
        }
      />
    </button>
  );
}

function CustomersPanel({
  customers, devices, loading, error,
  onToggleActive, onToggleVip, onToggleDevice, busy,
}: {
  customers: Customer[];
  devices: DeviceRow[];
  loading: boolean;
  error: Error | null;
  onToggleActive: (id: string, active: boolean) => void;
  onToggleVip: (id: string, vip: boolean) => void;
  onToggleDevice: (id: string, approved: boolean) => void;
  busy: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const byCustomerId: Record<string, DeviceRow[]> = {};
    for (const d of devices) {
      const cid = (d.customer_id ?? "") as string;
      if (!cid) continue;
      (byCustomerId[cid] ||= []).push(d);
    }
    return byCustomerId;
  }, [devices]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (s) {
        const hay = `${c.name ?? ""} ${c.mobile ?? ""} ${c.firm_name ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      const devs = grouped[c.id] ?? [];
      const anyDevPending = devs.some((d) => !d.is_approved);
      switch (filter) {
        case "pending": return !c.is_active;
        case "approved": return !!c.is_active;
        case "vip": return !!c.is_vip;
        case "device_pending": return anyDevPending;
        default: return true;
      }
    });
  }, [customers, grouped, search, filter]);

  if (loading) return <Center><Loader2 className="h-5 w-5 animate-spin text-primary" /></Center>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  const filterBtn = (key: Filter, label: string) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={
        "rounded-full px-2.5 py-1 text-[10px] font-medium border whitespace-nowrap " +
        (filter === key
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:text-foreground")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search mobile / name / firm"
          className="w-full rounded-md border border-border bg-background pl-7 pr-3 py-1.5 text-xs text-foreground"
        />
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {filterBtn("all", "All")}
        {filterBtn("pending", "Pending")}
        {filterBtn("approved", "Approved")}
        {filterBtn("vip", "VIP")}
        {filterBtn("device_pending", "Device Pending")}
      </div>

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No customers match.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 items-start">
        {filtered.map((c) => {
          const devs = grouped[c.id] ?? [];
          const open = !!expanded[c.id];
          const pendingDevCount = devs.filter((d) => !d.is_approved).length;
          return (
            <div key={c.id} className="rounded-lg border border-border bg-card">
              <div className="flex items-center gap-2 px-2.5 py-2">
                <button
                  onClick={() => setExpanded((m) => ({ ...m, [c.id]: !open }))}
                  className="p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Toggle devices"
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-medium text-card-foreground truncate">
                      {c.name || "—"}
                    </p>
                    {c.is_vip && <Crown className="h-3 w-3 text-primary" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {c.mobile || "—"}
                    {c.firm_name ? ` · ${c.firm_name}` : ""}
                    {c.city ? ` · ${c.city}` : ""}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    <Smartphone className="inline h-2.5 w-2.5 mr-0.5" />
                    {devs.length} device{devs.length === 1 ? "" : "s"}
                    {pendingDevCount > 0 && (
                      <span className="ml-1 text-destructive">· {pendingDevCount} pending</span>
                    )}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground">App</span>
                    <Switch
                      on={!!c.is_active}
                      onClick={() => onToggleActive(c.id, !c.is_active)}
                      disabled={busy}
                    />
                  </div>
                  <button
                    onClick={() => onToggleVip(c.id, !c.is_vip)}
                    disabled={busy}
                    className={
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border disabled:opacity-50 " +
                      (c.is_vip
                        ? "border-gold bg-gradient-to-r from-[oklch(0.82_0.14_85)] to-[oklch(0.68_0.11_80)] text-primary-foreground shadow-gold"
                        : "border-border text-muted-foreground hover:text-primary hover:border-primary/40")
                    }
                  >
                    <Crown className="h-2.5 w-2.5" /> VIP
                  </button>
                </div>
              </div>
              {open && (
                <div className="border-t border-border bg-background/40 px-2.5 py-2 space-y-1.5">
                  {devs.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">No devices linked.</p>
                  ) : (
                    devs.map((d) => (
                      <div key={d.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium truncate">{d.device_name || "Device"}</p>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">
                            {(d.device_id || d.id || "").toString().slice(0, 12)}
                          </p>
                          {d.created_at && (
                            <p className="text-[9px] text-muted-foreground">
                              {new Date(d.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                            </p>
                          )}
                        </div>
                        <Switch
                          on={!!d.is_approved}
                          onClick={() => onToggleDevice(d.id, !d.is_approved)}
                          disabled={busy}
                        />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}
