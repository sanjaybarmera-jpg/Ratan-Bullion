import { createServerFn } from "@tanstack/react-start";
import { rbSupabaseAdmin, getRbAdminUrl } from "@/integrations/rb-supabase/client.server";
import { recalculateAllRates } from "@/lib/rb-rates-recalc.server";

type AdminSession = {
  id: string;
  admin_key: string;
  expires_at: string | null;
  revoked_at: string | null;
};

// ---------- Crypto helpers (Web Crypto; runs in Worker SSR + Node dev) ----------
function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(buf));
}
// Worker runtime caps PBKDF2 iterations at 100_000.
const PBKDF2_ITERS = 100_000;
const PBKDF2_MAX_ITERS = 100_000;
async function pbkdf2Hash(pin: string, saltB64?: string, iters = PBKDF2_ITERS): Promise<string> {
  const safeIters = Math.min(iters, PBKDF2_MAX_ITERS);
  const enc = new TextEncoder();
  const saltBytes = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  // Copy into a fresh ArrayBuffer to satisfy BufferSource typing on Workers.
  const salt = new Uint8Array(saltBytes.byteLength);
  salt.set(saltBytes);
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer, iterations: safeIters, hash: "SHA-256" }, key, 256
  );
  return `pbkdf2$${safeIters}$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(bits))}`;
}
async function pbkdf2Verify(pin: string, stored: string): Promise<boolean> {
  if (!stored.startsWith("pbkdf2$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const iters = Number(parts[1]);
  if (!Number.isFinite(iters) || iters < 1) return false;
  // The runtime caps PBKDF2 iterations; refuse to attempt a derive that
  // would throw. Hashes above the cap (legacy 120_000) cannot be verified
  // here — admins in that state must rotate their PIN via the recovery
  // path. In practice no such hash exists because the previous SET path
  // also failed at 120_000.
  if (iters > PBKDF2_MAX_ITERS) return false;
  try {
    const recomputed = await pbkdf2Hash(pin, parts[2], iters);
    return timingSafeEqualStr(recomputed, stored);
  } catch {
    return false;
  }
}
function isHashedPin(s: string): boolean {
  return typeof s === "string" && s.startsWith("pbkdf2$");
}

async function checkAdmin(
  token: string,
): Promise<{ ok: true; session: AdminSession } | { ok: false; reason: string }> {
  if (!token) {
    return { ok: false, reason: "missing_token" };
  }
  const tokenHash = await sha256Hex(token);
  const { data, error } = await rbSupabaseAdmin
    .from("admin_sessions")
    .select("id, admin_key, expires_at, revoked_at")
    .eq("admin_key", tokenHash)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: "invalid_token" };
  if (data.revoked_at) return { ok: false, reason: "revoked" };
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, session: data as AdminSession };
}

function randomToken() {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPlainPin(
  username: string,
  pin: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (username !== "admin") return { ok: false, error: "invalid_credentials" };
  const { data, error } = await rbSupabaseAdmin
    .from("admin_security")
    .select("setting_value")
    .eq("setting_key", "admin_pin")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const stored = (data?.setting_value ?? "").toString().trim();
  if (!stored) return { ok: false, error: "invalid_credentials" };

  let valid = false;
  if (isHashedPin(stored)) {
    valid = await pbkdf2Verify(pin, stored);
    if (valid) {
      // Migrate to current iteration count if stored hash uses a different one.
      const storedIters = Number(stored.split("$")[1]);
      if (storedIters !== PBKDF2_ITERS) {
        try {
          const rehashed = await pbkdf2Hash(pin);
          await rbSupabaseAdmin
            .from("admin_security")
            .update({ setting_value: rehashed, updated_at: new Date().toISOString() })
            .eq("setting_key", "admin_pin");
        } catch {
          // Non-fatal; next successful PIN change will re-hash.
        }
      }
    }
  } else {
    // Legacy plaintext PIN — accept once, then auto-upgrade to PBKDF2.
    valid = timingSafeEqualStr(stored, pin);
    if (valid) {
      try {
        const hashed = await pbkdf2Hash(pin);
        await rbSupabaseAdmin
          .from("admin_security")
          .update({ setting_value: hashed, updated_at: new Date().toISOString() })
          .eq("setting_key", "admin_pin");
      } catch {
        // Don't block login on upgrade failure; next save will hash anyway.
      }
    }
  }
  if (!valid) return { ok: false, error: "invalid_credentials" };
  return { ok: true };
}

async function issueAdminSession(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error: insErr } = await rbSupabaseAdmin
    .from("admin_sessions")
    .insert({ admin_key: tokenHash, token_hash: tokenHash, expires_at: expires });
  if (insErr) return { ok: false, error: insErr.message };
  return { ok: true, token };
}

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((input: { username: string; pin: string }) => {
    if (!input || typeof input.username !== "string" || typeof input.pin !== "string") {
      throw new Error("Invalid input");
    }
    return { username: input.username.trim(), pin: input.pin.trim() };
  })
  .handler(async ({ data }) => {
    // PIN verification: try RPC first, but DISCARD any token it returns —
    // the RPC writes session rows in a format incompatible with checkAdmin.
    // We always mint our own session keyed by sha256(token).
    let pinValid = false;
    let path: "rpc" | "plain" | "none" = "none";
    try {
      const { data: rpc, error } = await rbSupabaseAdmin.rpc("verify_admin_pin", {
        p_username: data.username,
        p_pin: data.pin,
        p_ip: null,
        p_user_agent: null,
      });
      if (!error) {
        const payload = rpc as Record<string, unknown> | null;
        if (payload && payload.ok !== false) {
          pinValid = true;
          path = "rpc";
        }
      }
    } catch {
      // ignore and fall through to plain-pin verify
    }
    if (!pinValid) {
      const v = await verifyPlainPin(data.username, data.pin);
      if (v.ok) {
        pinValid = true;
        path = "plain";
      } else {
        return { ok: false as const, error: v.error };
      }
    }
    const issued = await issueAdminSession();
    if (!issued.ok) return { ok: false as const, error: issued.error };
    void path;
    return { ok: true as const, token: issued.token };
  });

export const adminLogout = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => ({ token: String(input?.token ?? "") }))
  .handler(async ({ data }) => {
    if (!data.token) return { ok: true };
    const tokenHash = await sha256Hex(data.token);
    await rbSupabaseAdmin
      .from("admin_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("admin_key", tokenHash);
    return { ok: true };
  });

export const adminListCustomers = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => ({ token: String(input?.token ?? "") }))
  .handler(async ({ data }) => {
    const __auth = await checkAdmin(data.token); if (!__auth.ok) return { unauthorized: true, error: __auth.reason } as any;
    const { data: rows, error } = await rbSupabaseAdmin
      .from("customers")
      .select("id, name, mobile, city, firm_name, gst_no, is_active, is_vip, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return { customers: rows ?? [] };
  });

export const adminSetCustomerActive = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; id: string; active: boolean }) => ({
    token: String(input?.token ?? ""),
    id: String(input?.id ?? ""),
    active: Boolean(input?.active),
  }))
  .handler(async ({ data }) => {
    const __auth = await checkAdmin(data.token); if (!__auth.ok) return { unauthorized: true, error: __auth.reason } as any;
    const { error } = await rbSupabaseAdmin
      .from("customers")
      .update({ is_active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetCustomerVip = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; id: string; vip: boolean }) => ({
    token: String(input?.token ?? ""),
    id: String(input?.id ?? ""),
    vip: Boolean(input?.vip),
  }))
  .handler(async ({ data }) => {
    const __auth = await checkAdmin(data.token); if (!__auth.ok) return { unauthorized: true, error: __auth.reason } as any;
    const { error } = await rbSupabaseAdmin
      .from("customers")
      .update({ is_vip: data.vip })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListDevices = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => ({ token: String(input?.token ?? "") }))
  .handler(async ({ data }) => {
    const __auth = await checkAdmin(data.token); if (!__auth.ok) return { unauthorized: true, error: __auth.reason } as any;
    const { data: rows, error } = await rbSupabaseAdmin
      .from("customer_devices")
      .select("id, mobile, device_id, device_name, user_agent, is_approved, last_login_at, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    // Resolve customer_id by joining on mobile (no FK column on customer_devices).
    const mobiles = Array.from(
      new Set((rows ?? []).map((r: any) => String(r?.mobile ?? "")).filter(Boolean))
    );
    let mobileToCustomerId: Record<string, string> = {};
    if (mobiles.length > 0) {
      const { data: custRows, error: custErr } = await rbSupabaseAdmin
        .from("customers")
        .select("id, mobile")
        .in("mobile", mobiles);
      if (custErr) {
        console.error("[adminListDevices] customer lookup failed", custErr);
      } else {
        for (const c of (custRows ?? []) as Array<{ id: string; mobile: string }>) {
          if (c?.mobile) mobileToCustomerId[c.mobile] = c.id;
        }
      }
    }
    const devices = (rows ?? []).map((r: any) => ({
      ...r,
      is_approved: !!r.is_approved,
      customer_id: mobileToCustomerId[String(r?.mobile ?? "")] ?? null,
    }));
    return { devices };
  });

export const adminSetDeviceApproved = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; id: string; approved: boolean }) => ({
    token: String(input?.token ?? ""),
    id: String(input?.id ?? ""),
    approved: Boolean(input?.approved),
  }))
  .handler(async ({ data }) => {
    const __auth = await checkAdmin(data.token); if (!__auth.ok) return { unauthorized: true, error: __auth.reason } as any;
    const { data: updated, error } = await rbSupabaseAdmin
      .from("customer_devices")
      .update({ is_approved: data.approved })
      .eq("id", data.id)
      .select("id, is_approved");
    if (error) return { ok: false, error: error.message } as any;
    if (!updated || updated.length === 0) {
      return { ok: false, error: `No device row updated for id=${data.id}` } as any;
    }
    return { ok: true, updated };
  });

/* ---------------- Rates ---------------- */
export const adminListRates = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string }) => ({ token: String(i?.token ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { data: rows, error } = await rbSupabaseAdmin
      .from("rates").select("*").order("metal_type", { ascending: true });
    if (error) throw new Error(error.message);
    return { rates: rows ?? [] };
  });

export const adminUpdateRate = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; id: string; patch: Record<string, unknown> }) => ({
    token: String(i?.token ?? ""), id: String(i?.id ?? ""), patch: i?.patch ?? {},
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true, error: (a as any).reason } as any;
    const allowed = ["mcx_ltp","premium","spread","buy_price","sell_price","high","low","is_available","customer_sell_enabled","metal_type"] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in data.patch) patch[k] = data.patch[k];
    patch.updated_at = new Date().toISOString();
    try {
      const { data: updated, error } = await rbSupabaseAdmin
        .from("rates").update(patch).eq("id", data.id).select("id, metal_type, mcx_ltp, high, low, premium, spread, is_available, customer_sell_enabled");
      if (error) return { ok: false, error: error.message } as any;
      if (!updated || updated.length === 0) {
        return { ok: false, error: `No row updated for id=${data.id}. Check RLS / service role / row exists.` } as any;
      }
      // Sync mcx_ltp / high / low across the same metal family (gold or silver),
      // so every purity row of the same metal shares the SAME raw MCX LTP.
      // Purity differences belong to premium/spread only — NEVER multiply
      // mcx_ltp by 0.98, 0.993, etc.
      //
      // To avoid a purity-adjusted row ever overwriting the base, the sync
      // only fires when the source row is the 999 base (GOLD_999* or
      // SILVER_999*). Pushing updates on a 9930 / 98 row will not propagate
      // its mcx_ltp to siblings.
      try {
        const row = updated[0] as any;
        const mt = String(row?.metal_type ?? "").toUpperCase().replace(/[\s\-/.]+/g, "_");
        const isGold999 = mt.startsWith("GOLD_999") && !mt.startsWith("GOLD_9930") && !mt.startsWith("GOLD_993");
        const isSilver999 = mt.startsWith("SILVER_999");
        const family = isGold999 ? "GOLD" : isSilver999 ? "SILVER" : null;
        if (family) {
          // NOTE: only the raw MCX LTP is shared across the family.
          // High / Low are NEVER copied verbatim — every product row derives
          // them from the MCX session High/Low plus its OWN premium inside
          // recalculateAllRates(). Copying them here made product rows show
          // the bare MCX High/Low.
          const syncPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (row?.mcx_ltp != null) syncPatch.mcx_ltp = row.mcx_ltp;
          if (Object.keys(syncPatch).length > 1) {
            const { data: siblings, error: sibErr } = await rbSupabaseAdmin
              .from("rates")
              .update(syncPatch)
              .ilike("metal_type", `${family}%`)
              .neq("id", data.id)
              .neq("id", "gold")
              .neq("id", "silver")
              .select("id, metal_type, mcx_ltp");
            console.log("[adminUpdateRate] family sync (from 999 base)", { family, syncPatch, siblings, sibErr });
          }
        } else {
          console.log("[adminUpdateRate] family sync skipped (source is not 999 base)", { metal_type: mt });
        }
      } catch (syncEx) {
        console.error("[adminUpdateRate] family sync exception", syncEx);
      }
      try {
        const recalc = await recalculateAllRates(rbSupabaseAdmin);
        console.log("[adminUpdateRate] recalculateAllRates", recalc);
      } catch (recalcEx) {
        console.error("[adminUpdateRate] recalculateAllRates exception", recalcEx);
      }
      return { ok: true, updated };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[adminUpdateRate] exception", msg);
      return { ok: false, error: msg } as any;
    }
  });

/* ---------------- Bank ---------------- */
export const adminListBanks = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string }) => ({ token: String(i?.token ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { data: rows, error } = await rbSupabaseAdmin
      .from("bank_settings").select("*").order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { banks: rows ?? [] };
  });

export const adminUpsertBank = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; row: Record<string, unknown> }) => ({
    token: String(i?.token ?? ""), row: i?.row ?? {},
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const fields = ["label","bank_name","account_name","account_no","ifsc","branch","upi_id","gst_no","is_active","sort_order"] as const;
    const row: Record<string, unknown> = {};
    for (const k of fields) if (k in data.row) row[k] = data.row[k];
    row.updated_at = new Date().toISOString();
    const id = (data.row as any).id as string | undefined;
    if (id) {
      const { error } = await rbSupabaseAdmin.from("bank_settings").update(row).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: ins, error } = await rbSupabaseAdmin.from("bank_settings").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins?.id };
  });

export const adminDeleteBank = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; id: string }) => ({ token: String(i?.token ?? ""), id: String(i?.id ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { error } = await rbSupabaseAdmin.from("bank_settings").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- News ---------------- */
export const adminListNews = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string }) => ({ token: String(i?.token ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { data: rows, error } = await rbSupabaseAdmin
      .from("news").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { news: rows ?? [] };
  });

export const adminUpsertNews = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; row: Record<string, unknown> }) => ({
    token: String(i?.token ?? ""), row: i?.row ?? {},
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const fields = ["title","description","is_active"] as const;
    const row: Record<string, unknown> = {};
    for (const k of fields) if (k in data.row) row[k] = data.row[k];
    row.updated_at = new Date().toISOString();
    const id = (data.row as any).id as string | undefined;
    if (id) {
      const { error } = await rbSupabaseAdmin.from("news").update(row).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: ins, error } = await rbSupabaseAdmin.from("news").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins?.id };
  });

export const adminDeleteNews = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; id: string }) => ({ token: String(i?.token ?? ""), id: String(i?.id ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { error } = await rbSupabaseAdmin.from("news").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Orders (admin view) ---------------- */
export const adminListOrders = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; view?: string }) => ({
    token: String(i?.token ?? ""),
    view: String(i?.view ?? "active").toLowerCase(),
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const ACTIVE = ["PENDING", "CONFIRMED", "PROCESSING"];
    const COMPLETED = ["COMPLETED"];
    const REJECTED = ["REJECTED", "CANCELLED"];
    let query = rbSupabaseAdmin
      .from("orders")
      .select("id, customer_id, customer_name, customer_mobile, product, order_type, quantity, rate, total_amount, status, admin_note, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.view === "active") query = query.in("status", ACTIVE);
    else if (data.view === "completed") query = query.in("status", COMPLETED);
    else if (data.view === "rejected") query = query.in("status", REJECTED);
    // "all" => no status filter
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { orders: rows ?? [] };
  });

export const adminUpdateOrder = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; id: string; status?: string; admin_note?: string }) => ({
    token: String(i?.token ?? ""), id: String(i?.id ?? ""),
    status: i?.status != null ? String(i.status) : undefined,
    admin_note: i?.admin_note != null ? String(i.admin_note) : undefined,
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status !== undefined) {
      const allowed = new Set(["PENDING","CONFIRMED","PROCESSING","COMPLETED","REJECTED","CANCELLED"]);
      const next = String(data.status).toUpperCase();
      if (!allowed.has(next)) return { ok: false, error: "Invalid status" } as any;
      patch.status = next;
    }
    if (data.admin_note !== undefined) {
      const note = String(data.admin_note);
      if (note.length > 2000) return { ok: false, error: "Note too long" } as any;
      patch.admin_note = note;
    }
    const { error } = await rbSupabaseAdmin.from("orders").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Settings ---------------- */
export const adminGetSettings = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string }) => ({ token: String(i?.token ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const [{ data: pin }, { data: app }] = await Promise.all([
      rbSupabaseAdmin.from("admin_security").select("setting_key, setting_value").eq("setting_key", "admin_pin").maybeSingle(),
      rbSupabaseAdmin.from("app_settings").select("id, value_text, value"),
    ]);
    const app_settings = (app ?? []).map((r: any) => ({
      setting_key: r.id,
      // For the boolean booking key, expose the native boolean as a string
      // ("true"/"false") so the existing SettingsTab parsing keeps working.
      setting_value:
        r.id === "global_booking_enabled"
          ? (r.value === true ? "true" : r.value === false ? "false" : null)
          : r.value_text,
    }));
    // SECURITY: never return the PIN value (plaintext or hashed) to the
    // client. Expose only whether one is configured so the UI can show state.
    const stored = (pin?.setting_value ?? "").toString().trim();
    return {
      admin_pin_set: stored.length > 0,
      app_settings,
    };
  });

export const adminSetAdminPin = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; pin: string }) => ({ token: String(i?.token ?? ""), pin: String(i?.pin ?? "").trim() }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    if (!data.pin || data.pin.length < 4 || data.pin.length > 64) {
      throw new Error("PIN must be 4–64 characters");
    }
    const hashed = await pbkdf2Hash(data.pin);
    const { error } = await rbSupabaseAdmin
      .from("admin_security")
      .upsert({ setting_key: "admin_pin", setting_value: hashed, updated_at: new Date().toISOString() }, { onConflict: "setting_key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetAppSetting = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; key: string; value: string }) => ({
    token: String(i?.token ?? ""), key: String(i?.key ?? ""), value: String(i?.value ?? ""),
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token);
    if (!a.ok) {
      console.warn("[adminSetAppSetting] unauthorized", { reason: (a as any).reason, key: data.key });
      return { ok: false, unauthorized: true, error: (a as any).reason } as any;
    }
    if (!data.key) throw new Error("Key required");

    const isBookingKey = data.key === "global_booking_enabled";
    // For the boolean booking key, write the native boolean column `value`
    // (and force value_text=NULL). All other keys keep using value_text.
    const writePatch: Record<string, unknown> = isBookingKey
      ? { value: data.value === "true", value_text: null, updated_at: new Date().toISOString() }
      : { value_text: data.value, updated_at: new Date().toISOString() };
    const insertPatch: Record<string, unknown> = isBookingKey
      ? { id: data.key, value: data.value === "true", value_text: null, updated_at: new Date().toISOString() }
      : { id: data.key, value_text: data.value, updated_at: new Date().toISOString() };
    const selectCols = isBookingKey ? "id, value" : "id, value_text";

    const { data: prevRow } = await rbSupabaseAdmin
      .from("app_settings")
      .select(selectCols)
      .eq("id", data.key)
      .maybeSingle();
    console.log("[adminSetAppSetting] BEFORE", {
      row_id: data.key,
      prev: prevRow,
      new_value: data.value,
      column: isBookingKey ? "value (bool)" : "value_text",
    });

    const { data: updated, error: updErr } = await rbSupabaseAdmin
      .from("app_settings")
      .update(writePatch)
      .eq("id", data.key)
      .select(selectCols);
    if (updErr) return { ok: false, error: `update failed: ${updErr.message}` } as any;

    let finalRows = updated ?? [];
    if (!updated || updated.length === 0) {
      const { data: inserted, error: insErr } = await rbSupabaseAdmin
        .from("app_settings")
        .insert(insertPatch)
        .select(selectCols);
      if (insErr) return { ok: false, error: `insert failed: ${insErr.message}` } as any;
      finalRows = inserted ?? [];
    }

    const { data: verifyRow, error: verifyErr } = await rbSupabaseAdmin
      .from("app_settings")
      .select(selectCols + ", updated_at")
      .eq("id", data.key)
      .maybeSingle();
    if (verifyErr) return { ok: false, error: `verify failed: ${verifyErr.message}` } as any;
    if (!verifyRow) return { ok: false, error: "Row not present after write" } as any;

    if (isBookingKey) {
      const dbBool = (verifyRow as any).value as boolean | null;
      const expected = data.value === "true";
      console.log("[adminSetAppSetting] AFTER (booking bool)", { row_id: data.key, dbBool, expected });
      if (dbBool !== expected) {
        return {
          ok: false,
          error: `Mismatch: DB has ${dbBool} but expected ${expected}`,
          db_value: dbBool,
        } as any;
      }
      return { ok: true, db_value: dbBool ? "true" : "false", rows: finalRows };
    }

    const dbText = (verifyRow as any).value_text ?? "";
    if (dbText !== data.value) {
      return {
        ok: false,
        error: `Mismatch: DB has "${dbText}" but expected "${data.value}"`,
        db_value: dbText,
      } as any;
    }
    return { ok: true, db_value: dbText, rows: finalRows };
  });


/* ---------------- Jewellery Catalogue ---------------- */
const JEWEL_BUCKET = "jewellery-images";

function publicUrl(path: string): string {
  return `${getRbAdminUrl()}/storage/v1/object/public/${JEWEL_BUCKET}/${path}`;
}

export const adminListJewelleryCategories = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string }) => ({ token: String(i?.token ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { data: rows, error } = await rbSupabaseAdmin
      .from("jewellery_categories").select("*")
      .order("sort_order", { ascending: true }).order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { categories: rows ?? [] };
  });

export const adminUpsertJewelleryCategory = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; row: Record<string, unknown> }) => ({
    token: String(i?.token ?? ""), row: i?.row ?? {},
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const fields = ["name", "slug", "image_url", "sort_order", "is_active"] as const;
    const row: Record<string, unknown> = {};
    for (const k of fields) if (k in data.row) row[k] = data.row[k];
    if (typeof row.name === "string") row.name = row.name.trim();
    if (!row.name && !(data.row as any).id) throw new Error("Category name is required");
    if (row.slug === "") row.slug = null;
    if (row.sort_order !== undefined) row.sort_order = Number(row.sort_order) || 0;
    const id = (data.row as any).id as string | undefined;
    if (id) {
      const { error } = await rbSupabaseAdmin.from("jewellery_categories").update(row).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: ins, error } = await rbSupabaseAdmin
      .from("jewellery_categories").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins?.id };
  });

export const adminDeleteJewelleryCategory = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; id: string }) => ({ token: String(i?.token ?? ""), id: String(i?.id ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { error } = await rbSupabaseAdmin.from("jewellery_categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminUploadJewelleryImage = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; fileName: string; contentType: string; dataBase64: string; productId?: string | null; alt?: string | null }) => ({
    token: String(i?.token ?? ""),
    fileName: String(i?.fileName ?? "upload"),
    contentType: String(i?.contentType ?? "image/jpeg"),
    dataBase64: String(i?.dataBase64 ?? ""),
    productId: i?.productId ? String(i.productId) : null,
    alt: i?.alt ? String(i.alt) : null,
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    if (!data.dataBase64) throw new Error("No file data");
    const bin = atob(data.dataBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = (data.fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${data.productId ?? "categories"}/${Date.now()}-${randomToken().slice(0, 8)}.${ext}`;
    const { error: upErr } = await rbSupabaseAdmin.storage
      .from(JEWEL_BUCKET)
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (upErr) throw new Error(upErr.message);
    const url = publicUrl(path);
    if (!data.productId) return { ok: true, url, storage_path: path };

    const { data: last } = await rbSupabaseAdmin
      .from("jewellery_images").select("sort_order")
      .eq("product_id", data.productId)
      .order("sort_order", { ascending: false }).limit(1);
    const nextOrder = ((last?.[0] as any)?.sort_order ?? -1) + 1;
    const { data: ins, error } = await rbSupabaseAdmin.from("jewellery_images").insert({
      product_id: data.productId,
      storage_path: path,
      image_url: url,
      alt_text: data.alt,
      sort_order: nextOrder,
      is_active: true,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, url, storage_path: path, id: ins?.id };
  });

export const adminListJewelleryProducts = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string }) => ({ token: String(i?.token ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { data: rows, error } = await rbSupabaseAdmin
      .from("jewellery_products").select("*, jewellery_images(*)")
      .order("sort_order", { ascending: true }).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { products: rows ?? [] };
  });

export const adminUpsertJewelleryProduct = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; row: Record<string, unknown> }) => ({
    token: String(i?.token ?? ""), row: i?.row ?? {},
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const fields = [
      "product_code", "name", "category_id", "collection_id", "product_type", "metal", "purity",
      "gross_weight", "net_weight", "making_charge", "description",
      "is_active", "sort_order",
    ] as const;
    const row: Record<string, unknown> = {};
    for (const k of fields) if (k in data.row) row[k] = data.row[k];
    for (const k of ["gross_weight", "net_weight"] as const) {
      if (k in row) row[k] = row[k] === "" || row[k] === null ? null : Number(row[k]);
    }
    if ("sort_order" in row) row.sort_order = Number(row.sort_order) || 0;
    if (row.category_id === "") row.category_id = null;
    if (typeof row.name === "string") row.name = row.name.trim();
    if (typeof row.product_code === "string") row.product_code = row.product_code.trim();
    const id = (data.row as any).id as string | undefined;
    if (!id) {
      if (!row.name) throw new Error("Product name is required");
      if (!row.product_code) throw new Error("Product code is required");
    }
    row.updated_at = new Date().toISOString();
    if (id) {
      const { error } = await rbSupabaseAdmin.from("jewellery_products").update(row).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: ins, error } = await rbSupabaseAdmin
      .from("jewellery_products").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins?.id };
  });

export const adminDeleteJewelleryProduct = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; id: string }) => ({ token: String(i?.token ?? ""), id: String(i?.id ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { data: imgs } = await rbSupabaseAdmin
      .from("jewellery_images").select("storage_path").eq("product_id", data.id);
    const paths = (imgs ?? []).map((r: any) => r.storage_path).filter(Boolean) as string[];
    if (paths.length) await rbSupabaseAdmin.storage.from(JEWEL_BUCKET).remove(paths);
    const { error } = await rbSupabaseAdmin.from("jewellery_products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteJewelleryImage = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; id: string }) => ({ token: String(i?.token ?? ""), id: String(i?.id ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { data: img } = await rbSupabaseAdmin
      .from("jewellery_images").select("storage_path").eq("id", data.id).maybeSingle();
    const path = (img as any)?.storage_path as string | undefined;
    const { error } = await rbSupabaseAdmin.from("jewellery_images").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (path) await rbSupabaseAdmin.storage.from(JEWEL_BUCKET).remove([path]);
    return { ok: true };
  });

export const adminReorderJewelleryImages = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; ids: string[] }) => ({
    token: String(i?.token ?? ""),
    ids: Array.isArray(i?.ids) ? i.ids.map(String) : [],
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    for (let idx = 0; idx < data.ids.length; idx++) {
      const { error } = await rbSupabaseAdmin
        .from("jewellery_images").update({ sort_order: idx }).eq("id", data.ids[idx]);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/* ---------------- Jewellery Collections (Metal → Type → Collection) ---------------- */

const COLLECTIONS_MISSING =
  "jewellery_collections table not found. Run docs/sql/phase18_jewellery_collections.sql in the RB Supabase SQL editor.";

function isMissingTable(msg: string): boolean {
  return /jewellery_collections/i.test(msg) && /(does not exist|schema cache|not find)/i.test(msg);
}

export const adminListJewelleryCollections = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string }) => ({ token: String(i?.token ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { data: rows, error } = await rbSupabaseAdmin
      .from("jewellery_collections").select("*")
      .order("sort_order", { ascending: true }).order("collection_name", { ascending: true });
    if (error) {
      if (isMissingTable(error.message)) return { collections: [], setupRequired: true } as any;
      throw new Error(error.message);
    }
    return { collections: rows ?? [], setupRequired: false };
  });

export const adminUpsertJewelleryCollection = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; row: Record<string, unknown> }) => ({
    token: String(i?.token ?? ""), row: i?.row ?? {},
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const fields = ["category_id", "product_type", "collection_name", "sort_order", "is_active"] as const;
    const row: Record<string, unknown> = {};
    for (const k of fields) if (k in data.row) row[k] = data.row[k];
    for (const k of ["product_type", "collection_name"] as const) {
      if (typeof row[k] === "string") row[k] = (row[k] as string).trim();
    }
    if ("sort_order" in row) row.sort_order = Number(row.sort_order) || 0;
    const id = (data.row as any).id as string | undefined;
    if (!id) {
      if (!row.category_id) throw new Error("Metal / category is required");
      if (!row.product_type) throw new Error("Product type is required");
      if (!row.collection_name) throw new Error("Collection name is required");
    }
    if (id) {
      const { error } = await rbSupabaseAdmin.from("jewellery_collections").update(row).eq("id", id);
      if (error) throw new Error(isMissingTable(error.message) ? COLLECTIONS_MISSING : error.message);
      return { ok: true, id };
    }
    const { data: ins, error } = await rbSupabaseAdmin
      .from("jewellery_collections").insert(row).select("id").single();
    if (error) throw new Error(isMissingTable(error.message) ? COLLECTIONS_MISSING : error.message);
    return { ok: true, id: ins?.id };
  });

export const adminDeleteJewelleryCollection = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; id: string }) => ({ token: String(i?.token ?? ""), id: String(i?.id ?? "") }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { count } = await rbSupabaseAdmin
      .from("jewellery_products").select("id", { count: "exact", head: true })
      .eq("collection_id", data.id);
    if ((count ?? 0) > 0) throw new Error(`Collection has ${count} products. Delete or move them first.`);
    const { error } = await rbSupabaseAdmin.from("jewellery_collections").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- Collection-scoped products ---------- */

function codeToken(s: string, n: number): string {
  const clean = (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (clean.slice(0, n) || "X").padEnd(Math.min(n, 2), "X");
}

export const adminListCollectionProducts = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; collectionId: string }) => ({
    token: String(i?.token ?? ""), collectionId: String(i?.collectionId ?? ""),
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    const { data: rows, error } = await rbSupabaseAdmin
      .from("jewellery_products").select("*, jewellery_images(*)")
      .eq("collection_id", data.collectionId)
      .order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { products: rows ?? [] };
  });

/** One uploaded image → one product, inheriting metal / type / collection. */
export const adminCreateProductFromImage = createServerFn({ method: "POST" })
  .inputValidator((i: {
    token: string; collectionId: string; fileName: string; contentType: string; dataBase64: string;
  }) => ({
    token: String(i?.token ?? ""),
    collectionId: String(i?.collectionId ?? ""),
    fileName: String(i?.fileName ?? "upload.jpg"),
    contentType: String(i?.contentType ?? "image/jpeg"),
    dataBase64: String(i?.dataBase64 ?? ""),
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    if (!data.dataBase64) throw new Error("No file data");

    const { data: col, error: colErr } = await rbSupabaseAdmin
      .from("jewellery_collections").select("*").eq("id", data.collectionId).maybeSingle();
    if (colErr) throw new Error(isMissingTable(colErr.message) ? COLLECTIONS_MISSING : colErr.message);
    if (!col) throw new Error("Collection not found");

    const { data: cat } = await rbSupabaseAdmin
      .from("jewellery_categories").select("id, name").eq("id", (col as any).category_id).maybeSingle();

    const metal = ((cat as any)?.name ?? "") as string;
    const productType = ((col as any).product_type ?? "") as string;
    const prefix = `${codeToken(metal, 2)}-${codeToken(productType, 3)}-`;

    // Next sequence for this prefix
    const { data: existing } = await rbSupabaseAdmin
      .from("jewellery_products").select("product_code")
      .like("product_code", `${prefix}%`);
    let maxSeq = 0;
    for (const r of (existing ?? []) as any[]) {
      const n = Number(String(r.product_code ?? "").slice(prefix.length));
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
    const productCode = `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;

    const { data: lastSort } = await rbSupabaseAdmin
      .from("jewellery_products").select("sort_order")
      .eq("collection_id", data.collectionId)
      .order("sort_order", { ascending: false }).limit(1);
    const nextSort = (((lastSort?.[0] as any)?.sort_order ?? -1) as number) + 1;

    const { data: prod, error: prodErr } = await rbSupabaseAdmin
      .from("jewellery_products").insert({
        collection_id: data.collectionId,
        category_id: (col as any).category_id,
        metal,
        product_type: productType,
        name: `${(col as any).collection_name} ${productType}`.trim(),
        product_code: productCode,
        description: null,
        is_active: true,
        sort_order: nextSort,
      }).select("id").single();
    if (prodErr) throw new Error(prodErr.message);

    const productId = (prod as any).id as string;
    const bin = atob(data.dataBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = (data.fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${productId}/${Date.now()}-${randomToken().slice(0, 8)}.${ext}`;
    const { error: upErr } = await rbSupabaseAdmin.storage
      .from(JEWEL_BUCKET).upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (upErr) {
      await rbSupabaseAdmin.from("jewellery_products").delete().eq("id", productId);
      throw new Error(upErr.message);
    }
    const url = publicUrl(path);
    const { error: imgErr } = await rbSupabaseAdmin.from("jewellery_images").insert({
      product_id: productId, storage_path: path, image_url: url,
      alt_text: productCode, sort_order: 0, is_active: true,
    });
    if (imgErr) throw new Error(imgErr.message);

    return { ok: true, id: productId, product_code: productCode, url };
  });

/** Replace the primary image of a product. */
export const adminReplaceProductImage = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; productId: string; fileName: string; contentType: string; dataBase64: string }) => ({
    token: String(i?.token ?? ""),
    productId: String(i?.productId ?? ""),
    fileName: String(i?.fileName ?? "upload.jpg"),
    contentType: String(i?.contentType ?? "image/jpeg"),
    dataBase64: String(i?.dataBase64 ?? ""),
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    if (!data.dataBase64) throw new Error("No file data");
    const bin = atob(data.dataBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = (data.fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${data.productId}/${Date.now()}-${randomToken().slice(0, 8)}.${ext}`;
    const { error: upErr } = await rbSupabaseAdmin.storage
      .from(JEWEL_BUCKET).upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (upErr) throw new Error(upErr.message);
    const url = publicUrl(path);

    const { data: imgs } = await rbSupabaseAdmin
      .from("jewellery_images").select("id, storage_path")
      .eq("product_id", data.productId)
      .order("sort_order", { ascending: true }).limit(1);
    const first = (imgs ?? [])[0] as any;
    if (first) {
      const { error } = await rbSupabaseAdmin
        .from("jewellery_images").update({ storage_path: path, image_url: url }).eq("id", first.id);
      if (error) throw new Error(error.message);
      if (first.storage_path) await rbSupabaseAdmin.storage.from(JEWEL_BUCKET).remove([first.storage_path]);
    } else {
      const { error } = await rbSupabaseAdmin.from("jewellery_images").insert({
        product_id: data.productId, storage_path: path, image_url: url, sort_order: 0, is_active: true,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true, url };
  });

export const adminBulkUpdateJewelleryProducts = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; ids: string[]; action: string }) => ({
    token: String(i?.token ?? ""),
    ids: Array.isArray(i?.ids) ? i.ids.map(String) : [],
    action: String(i?.action ?? ""),
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    if (!data.ids.length) return { ok: true, affected: 0 };
    if (data.action === "activate" || data.action === "deactivate") {
      const { error } = await rbSupabaseAdmin
        .from("jewellery_products")
        .update({ is_active: data.action === "activate" })
        .in("id", data.ids);
      if (error) throw new Error(error.message);
      return { ok: true, affected: data.ids.length };
    }
    if (data.action === "delete") {
      const { data: imgs } = await rbSupabaseAdmin
        .from("jewellery_images").select("storage_path").in("product_id", data.ids);
      const paths = (imgs ?? []).map((r: any) => r.storage_path).filter(Boolean) as string[];
      if (paths.length) await rbSupabaseAdmin.storage.from(JEWEL_BUCKET).remove(paths);
      const { error } = await rbSupabaseAdmin.from("jewellery_products").delete().in("id", data.ids);
      if (error) throw new Error(error.message);
      return { ok: true, affected: data.ids.length };
    }
    throw new Error("Unknown bulk action");
  });

export const adminReorderJewelleryProducts = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string; ids: string[] }) => ({
    token: String(i?.token ?? ""),
    ids: Array.isArray(i?.ids) ? i.ids.map(String) : [],
  }))
  .handler(async ({ data }) => {
    const a = await checkAdmin(data.token); if (!a.ok) return { unauthorized: true } as any;
    for (let idx = 0; idx < data.ids.length; idx++) {
      const { error } = await rbSupabaseAdmin
        .from("jewellery_products").update({ sort_order: idx }).eq("id", data.ids[idx]);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
