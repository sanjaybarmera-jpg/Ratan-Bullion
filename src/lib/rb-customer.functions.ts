import { createServerFn } from "@tanstack/react-start";
import { rbSupabaseAdmin } from "@/integrations/rb-supabase/client.server";

function normalizeMobile(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits.slice(-10);
}

// Server-side identity gate. Re-validates (mobile, deviceId) against the DB
// using the same SECURITY DEFINER RPC the client login flow uses, so that
// no customer-scoped data is returned without an approved device.
async function assertGranted(mobile: string, deviceId: string): Promise<boolean> {
  if (mobile.length !== 10 || !deviceId) return false;
  try {
    const { data, error } = await rbSupabaseAdmin.rpc("verify_customer_access", {
      p_mobile: mobile,
      p_device_id: deviceId,
    });
    if (error) return false;
    const r = data as { access?: string } | null;
    return !!r && r.access === "granted";
  } catch {
    return false;
  }
}

// -------- Open-position limits (per metal, in grams) --------
const GOLD_LIMIT_GM = 100;
const SILVER_LIMIT_GM = 5000;
const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "PROCESSING"];
const TERMINAL_STATUSES = new Set(["COMPLETED", "REJECTED", "CANCELLED"]);

// IST (Asia/Kolkata) calendar day as YYYY-MM-DD.
function istDayString(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  // IST = UTC+5:30, no DST.
  const shifted = new Date(date.getTime() + (5 * 60 + 30) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function classifyMetal(product: string): "gold" | "silver" | null {
  const s = (product || "").toUpperCase();
  if (s.includes("GOLD")) return "gold";
  if (s.includes("SILVER")) return "silver";
  return null;
}

async function computeOpenPositions(mobile: string) {
  const { data } = await rbSupabaseAdmin
    .from("orders")
    .select("product, quantity, status")
    .eq("customer_mobile", mobile)
    .in("status", ACTIVE_STATUSES);
  let gold = 0;
  let silver = 0;
  for (const row of (data ?? []) as Array<{ product: string | null; quantity: number | null }>) {
    const m = classifyMetal(String(row.product ?? ""));
    const q = Number(row.quantity) || 0;
    if (m === "gold") gold += q;
    else if (m === "silver") silver += q;
  }
  return {
    goldOpenGm: gold,
    silverOpenGm: silver,
    goldLimitGm: GOLD_LIMIT_GM,
    silverLimitGm: SILVER_LIMIT_GM,
    goldAvailableGm: Math.max(0, GOLD_LIMIT_GM - gold),
    silverAvailableGm: Math.max(0, SILVER_LIMIT_GM - silver),
  };
}

export const getOpenPositions = createServerFn({ method: "POST" })
  .inputValidator((input: { mobile: string; deviceId: string }) => ({
    mobile: String(input?.mobile ?? ""),
    deviceId: String(input?.deviceId ?? ""),
  }))
  .handler(async ({ data }) => {
    const mobile = normalizeMobile(data.mobile);
    const zero = {
      goldOpenGm: 0,
      silverOpenGm: 0,
      goldLimitGm: GOLD_LIMIT_GM,
      silverLimitGm: SILVER_LIMIT_GM,
      goldAvailableGm: GOLD_LIMIT_GM,
      silverAvailableGm: SILVER_LIMIT_GM,
    };
    if (mobile.length !== 10 || !data.deviceId) return zero;
    const ok = await assertGranted(mobile, data.deviceId);
    if (!ok) return zero;
    return await computeOpenPositions(mobile);
  });

export const getMyOrders = createServerFn({ method: "POST" })
  .inputValidator((input: { mobile: string; deviceId: string }) => ({
    mobile: String(input?.mobile ?? ""),
    deviceId: String(input?.deviceId ?? ""),
  }))
  .handler(async ({ data }) => {
    const mobile = normalizeMobile(data.mobile);
    if (mobile.length !== 10 || !data.deviceId) {
      return { unauthorized: true, orders: [] as any[] };
    }
    const { data: rows, error } = await rbSupabaseAdmin.rpc("get_customer_orders", {
      p_mobile: mobile,
      p_device_id: data.deviceId,
    });
    if (error) throw new Error(error.message);
    const all = Array.isArray(rows) ? rows : [];
    // Customer Order Book auto-cleanup:
    //   - Always show active statuses (PENDING / CONFIRMED / PROCESSING / others).
    //   - Show terminal statuses (COMPLETED / REJECTED / CANCELLED) only on the
    //     same IST trading day they were last updated; hide from the next day.
    const todayIst = istDayString(new Date());
    const list = all.filter((o: any) => {
      const status = String(o?.status ?? "").toUpperCase();
      if (!TERMINAL_STATUSES.has(status)) return true;
      const stamp = istDayString(o?.updated_at ?? o?.created_at ?? null);
      return stamp != null && stamp === todayIst;
    });
    if (list.length === 0) {
      // RPC returns empty set both for "no orders" and "unauthorized".
      // Cheaply re-check access to surface the unauthorized state.
      const access = await rbSupabaseAdmin.rpc("verify_customer_access", {
        p_mobile: mobile,
        p_device_id: data.deviceId,
      });
      const r = access.data as { access?: string } | null;
      if (!r || r.access !== "granted") {
        return { unauthorized: true, orders: [] as any[] };
      }
    }
    return { orders: list };
  });

export const placeOrder = createServerFn({ method: "POST" })
  .inputValidator((input: {
    mobile: string;
    deviceId: string;
    product: string;
    orderType: string;
    quantity: number;
    rate: number;
    totalAmount: number;
  }) => ({
    mobile: String(input?.mobile ?? ""),
    deviceId: String(input?.deviceId ?? ""),
    product: String(input?.product ?? ""),
    orderType: String(input?.orderType ?? ""),
    quantity: Number(input?.quantity ?? 0),
    rate: Number(input?.rate ?? 0),
    totalAmount: Number(input?.totalAmount ?? 0),
  }))
  .handler(async ({ data }) => {
    const mobile = normalizeMobile(data.mobile);
    if (mobile.length !== 10 || !data.deviceId) {
      return { success: false, message: "Invalid session" };
    }

    // Strict input validation — defence in depth on top of the RPC checks.
    const orderType = String(data.orderType || "").toUpperCase();
    if (orderType !== "BUY" && orderType !== "SELL") {
      return { success: false, message: "Invalid order type" };
    }
    const qty = Number(data.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10000) {
      return { success: false, message: "Invalid quantity" };
    }
    const product = String(data.product || "").trim();
    if (!product || product.length > 64) {
      return { success: false, message: "Invalid product" };
    }

    // Re-verify (mobile, deviceId) against the DB before any work.
    {
      const ok = await assertGranted(mobile, data.deviceId);
      if (!ok) return { success: false, message: "Session not approved" };
    }

    // Global booking switch (server-side, fail-closed). Reads the native
    // boolean column `value` from app_settings. NULL or false blocks orders.
    {
      let globalOn = false;
      try {
        const { data: gRow, error: gErr } = await rbSupabaseAdmin
          .from("app_settings")
          .select("value")
          .eq("id", "global_booking_enabled")
          .maybeSingle();
        if (gErr) {
          console.warn("[placeOrder] global_booking_enabled read error", gErr.message);
        } else if (!gRow) {
          console.warn("[placeOrder] global_booking_enabled row missing — booking OFF");
        } else if ((gRow as { value: boolean | null }).value === null) {
          console.warn("[placeOrder] global_booking_enabled.value is NULL — booking OFF");
        } else {
          globalOn = (gRow as { value: boolean | null }).value === true;
        }
      } catch {
        globalOn = false;
      }
      if (!globalOn) {
        return { success: false, message: "Booking is temporarily closed by admin." };
      }
    }

    // Booking availability guard + LIVE rate re-fetch.
    //   - is_available controls overall product booking.
    //   - customer_sell_enabled additionally gates SELL orders.
    // Premium/spread are calculation-only and never gate booking.
    // We also recompute the final customer rate server-side from the latest
    // rates row (mcx_ltp + premium ± spread) so the client cannot lock in a
    // stale price.
    let liveSideRate: number | null = null;
    try {
      const norm = (s: string) =>
        s.toString().trim().toUpperCase().replace(/[\s\-/.]+/g, "_");
      const PRODUCT_ALIASES: Record<string, string[]> = {
        "GOLD_999":       ["GOLD_999", "GOLD_999_CASH"],
        "GOLD_99_30":     ["GOLD_9930", "GOLD_993", "GOLD_9930_CASH", "GOLD_993_CASH"],
        "SILVER_999":     ["SILVER_999", "SILVER_999_CASH"],
        "SILVER_98":      ["SILVER_98", "SILVER_98_CASH"],
        "GOLD_999_RTGS":  ["GOLD_999_RTGS"],
        "GOLD_99_30_RTGS":["GOLD_9930_RTGS", "GOLD_993_RTGS"],
        "SILVER_999_RTGS":["SILVER_999_RTGS"],
        "SILVER_98_RTGS": ["SILVER_98_RTGS"],
      };
      const key = norm(product);
      const aliases = PRODUCT_ALIASES[key] ?? [key];
      const { data: rateRows } = await rbSupabaseAdmin
        .from("rates")
        .select("id, metal_type, mcx_ltp, premium, spread, is_available, customer_sell_enabled, high, low");
      const wanted = new Set(aliases.map(norm));
      const all = (rateRows ?? []) as Array<any>;
      const row = all.find((r) =>
        wanted.has(norm(String(r?.metal_type ?? "")))
      );
      if (row) {
        if (row.is_available === false) {
          return { success: false, message: "Booking currently unavailable" };
        }
        const ot = orderType;
        if (ot === "SELL" && row.customer_sell_enabled === false) {
          return { success: false, message: "Sell booking currently unavailable" };
        }
        const metal = classifyMetal(product);
        const baseId = metal === "silver" ? "silver" : metal === "gold" ? "gold" : null;
        const baseRow = baseId
          ? all.find((r) => String(r.id ?? "").toLowerCase() === baseId)
          : undefined;
        const mcx = Number(baseRow?.mcx_ltp);
        const prem = Number(row.premium) || 0;
        const sprd = Number(row.spread) || 0;
        if (Number.isFinite(mcx) && mcx > 0) {
          liveSideRate = ot === "BUY" ? mcx + prem : mcx + prem - sprd;
        }
      }
    } catch {
      // Fail closed: any lookup error becomes a hard reject below.
      liveSideRate = null;
    }
    // SECURITY: never accept the client-sent rate as the order price.
    // If the live server-side rate could not be computed (unknown product,
    // missing rate row, or lookup failure), reject the order.
    if (liveSideRate == null || !Number.isFinite(liveSideRate) || liveSideRate <= 0) {
      return { success: false, message: "Live rate unavailable. Please retry." };
    }

    // -------- Open-position limit check (per metal) --------
    {
      const metal = classifyMetal(product);
      if (metal) {
        const pos = await computeOpenPositions(mobile);
        const limitGm = metal === "gold" ? pos.goldLimitGm : pos.silverLimitGm;
        const openGm = metal === "gold" ? pos.goldOpenGm : pos.silverOpenGm;
        const availGm = Math.max(0, limitGm - openGm);
        const requested = qty;
        if (requested > availGm) {
          const label = metal === "gold" ? "Gold" : "Silver";
          return {
            success: false,
            message: `Maximum open ${label} quantity is ${limitGm} gm. Available quantity: ${availGm} gm.`,
          };
        }
      }
    }

    // Look up Order Buffer Points (default 50) from app_settings
    let bufferPts = 50;
    try {
      const { data: bufRow } = await rbSupabaseAdmin
        .from("app_settings")
        .select("value_text")
        .eq("id", "order_buffer_points")
        .maybeSingle();
      const v = Number((bufRow as { value_text?: string } | null)?.value_text);
      if (Number.isFinite(v) && v >= 0) bufferPts = v;
    } catch {
      // ignore — fall back to default
    }

    // Authoritative server-side rate only — no client fallback.
    const baseRate = liveSideRate;
    const finalRate =
      orderType === "BUY" ? baseRate + bufferPts
      : orderType === "SELL" ? baseRate - bufferPts
      : baseRate;
    // Total recomputed from authoritative final rate. Silver is priced per kg
    // (qty gm × rate/1000); everything else is per 10 gm (qty gm × rate/10).
    const metalKind = classifyMetal(product);
    const divisor = metalKind === "silver" ? 1000 : 10;
    const finalTotal = qty * (finalRate / divisor);

    const { data: res, error } = await rbSupabaseAdmin.rpc("place_customer_order", {
      p_mobile: mobile,
      p_device_id: data.deviceId,
      p_product: product,
      p_order_type: orderType,
      p_quantity: qty,
      p_rate: finalRate,
      p_total_amount: finalTotal,
    });
    if (error) return { success: false, message: error.message };
    const r = (res ?? {}) as {
      success?: boolean;
      order_id?: string;
      status?: string;
      message?: string;
    };
    // Auto-accept: flip status to CONFIRMED immediately so dealer doesn't need to act.
    let finalStatus = r.status ?? null;
    if (r.success && r.order_id) {
      const { error: upErr } = await rbSupabaseAdmin
        .from("orders")
        .update({ status: "CONFIRMED" })
        .eq("id", r.order_id);
      if (!upErr) finalStatus = "CONFIRMED";
    }
    return {
      success: Boolean(r.success),
      orderId: r.order_id ?? null,
      status: finalStatus,
      rate: finalRate,
      totalAmount: finalTotal,
      message: r.message ?? "",
    };
  });