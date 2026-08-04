import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Save } from "lucide-react";
import { adminGetSettings, adminSetAdminPin, adminSetAppSetting } from "@/lib/rb-admin.functions";

type SettingRow = { setting_key: string; setting_value: string | null };

const APP_KEYS = [
  "order_buffer_points",
  "ticker_text",
  "contact_phone",
  "dealer_phone",
  "whatsapp_phone",
  "firm2_name",
  "firm2_business_type",
  "firm2_phone",
  "firm3_name",
  "firm3_business_type",
  "firm3_phone",
];

function isOn(v: string | null | undefined) {
  const s = (v ?? "").toString().trim().toLowerCase();
  // Fail-closed: blank / missing means booking OFF.
  return s === "true" || s === "1" || s === "on" || s === "yes";
}

export function SettingsTab({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetSettings);
  const setPinFn = useServerFn(adminSetAdminPin);
  const setAppFn = useServerFn(adminSetAppSetting);

  const q = useQuery({
    queryKey: ["admin-settings"],
    queryFn: async () => {
      const r: any = await getFn({ data: { token } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { admin_pin_set: boolean; app_settings: SettingRow[] };
    },
  });

  const [pin, setPin] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});

  useEffect(() => {
    if (q.data) {
      // SECURITY: server no longer returns the PIN. Keep the input blank;
      // admin types a new value only when they want to rotate it.
      setPin("");
      const map: Record<string, string> = {};
      for (const k of APP_KEYS) map[k] = "";
      for (const row of q.data.app_settings) map[row.setting_key] = row.setting_value ?? "";
      setVals(map);
      const be = q.data.app_settings.find((r) => r.setting_key === "global_booking_enabled");
      setBookingEnabled(isOn(be?.setting_value));
    }
  }, [q.data]);

  const savePin = useMutation({
    mutationFn: () => setPinFn({ data: { token, pin } }),
    onSuccess: () => {
      setPin("");
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
    },
  });
  const saveSetting = useMutation({
    mutationFn: (v: { key: string; value: string }) => setAppFn({ data: { token, ...v } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["rb", "app_settings", "market"] });
    },
  });
  const [bookingEnabled, setBookingEnabled] = useState(true);
  const saveBooking = useMutation({
    mutationFn: async (next: boolean) => {
      const payload = { key: "global_booking_enabled", value: next ? "true" : "false" };
      console.log("[SettingsTab] saveBooking →", payload);
      const res: any = await setAppFn({ data: { token, ...payload } });
      console.log("[SettingsTab] saveBooking ←", res);
      if (res?.unauthorized) {
        onUnauthorized();
        throw new Error("Session expired");
      }
      if (!res?.ok) {
        throw new Error(res?.error ?? "Save failed");
      }
      return res;
    },
    onSuccess: (res: any) => {
      // Trust the verified DB value returned by the server, not the optimistic UI state.
      const dbVal = String(res?.db_value ?? "").trim().toLowerCase();
      setBookingEnabled(dbVal === "true" || dbVal === "1" || dbVal === "on" || dbVal === "yes");
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["rb", "app_settings", "market"] });
      qc.invalidateQueries({ queryKey: ["rb", "app_settings", "global_booking_enabled"] });
    },
    onError: (_e, next) => {
      // Roll back optimistic toggle.
      setBookingEnabled(!next);
    },
  });

  if (q.isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gold/40 bg-card p-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-primary">Booking Enabled</h3>
          <p className="text-[11px] text-muted-foreground">
            Global switch. When OFF, even VIP customers cannot place orders.
          </p>
          {saveBooking.error && (
            <p className="text-[11px] text-destructive mt-1">
              Save failed: {(saveBooking.error as Error).message}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            const next = !bookingEnabled;
            setBookingEnabled(next);
            saveBooking.mutate(next);
          }}
          disabled={saveBooking.isPending}
          className={
            "relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 " +
            (bookingEnabled ? "bg-primary" : "bg-muted")
          }
          aria-pressed={bookingEnabled}
        >
          <span
            className={
              "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition " +
              (bookingEnabled ? "left-[22px]" : "left-0.5")
            }
          />
        </button>
      </section>

      <section className="rounded-lg border border-border bg-card p-3 space-y-2">
        <h3 className="text-sm font-semibold text-primary">Admin PIN</h3>
        <p className="text-[11px] text-muted-foreground">
          {q.data?.admin_pin_set ? "A PIN is configured. Enter a new value below to rotate it." : "No PIN set. Enter one to enable admin login."}
        </p>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          type="password"
          inputMode="numeric"
          placeholder="Enter new PIN"
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm tracking-widest text-foreground"
        />
        <button
          onClick={() => savePin.mutate()}
          disabled={savePin.isPending || !pin}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {savePin.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Update PIN
        </button>
        {savePin.error && <p className="text-xs text-destructive">{(savePin.error as Error).message}</p>}
      </section>

      <section className="rounded-lg border border-border bg-card p-3 space-y-3">
        <h3 className="text-sm font-semibold text-primary">Market Settings</h3>
        {saveSetting.error && (
          <p className="text-xs text-destructive">
            Save failed: {(saveSetting.error as Error).message}
          </p>
        )}
        {APP_KEYS.map((k) => (
          <div key={k} className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</label>
            <div className="flex gap-2">
              <input
                value={vals[k] ?? ""}
                onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
              <button
                onClick={() => saveSetting.mutate({ key: k, value: vals[k] ?? "" })}
                disabled={saveSetting.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}