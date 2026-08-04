import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Gem,
  LayoutDashboard,
  Package,
  ReceiptText,
  Users,
  IndianRupee,
  BellRing,
  LogOut,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

const nav = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/products", label: "Products", icon: Package, exact: false },
  { to: "/admin/orders", label: "Orders", icon: ReceiptText, exact: false },
  { to: "/admin/customers", label: "Customers", icon: Users, exact: false },
  { to: "/admin/rates", label: "Rates", icon: IndianRupee, exact: false },
  { to: "/admin/notifications", label: "Notify", icon: BellRing, exact: false },
] as const;

function AdminLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background pb-24 md:flex md:pb-0">
      <aside className="glass-panel sticky top-0 hidden h-screen w-60 shrink-0 flex-col rounded-none border-y-0 border-l-0 p-5 md:flex">
        <Link to="/" className="flex items-center gap-2">
          <Gem className="h-5 w-5 text-gold" />
          <span className="font-display text-lg">Ratan Jewellers</span>
        </Link>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-accent text-accent-foreground gold-ring"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Button variant="ghost" className="justify-start gap-3" onClick={signOut}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </aside>

      <header className="glass-panel sticky top-0 z-20 flex items-center justify-between rounded-none border-x-0 border-t-0 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <Gem className="h-4 w-4 text-gold" />
          <span className="font-display text-base">Ratan Jewellers</span>
        </div>
        <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
        <Outlet />
      </main>

      <nav className="glass-panel fixed inset-x-0 bottom-0 z-20 flex items-center justify-between rounded-none border-x-0 border-b-0 px-2 py-2 md:hidden">
        {nav.map((item) => {
          const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[0.6rem] ${
                active ? "text-gold" : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
