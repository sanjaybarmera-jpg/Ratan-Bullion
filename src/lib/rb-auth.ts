import { rbSupabase } from "@/integrations/rb-supabase/client";
import { getDeviceId, normalizeMobile } from "./rb-device";

export type AccessState =
  | "granted"
  | "pending_approval"
  | "device_pending"
  | "device_unregistered"
  | "no_customer"
  | "blocked"
  | "error";

export type AccessResponse = {
  ok: boolean;
  access: AccessState;
  customer_id?: string;
  customer_active?: boolean;
  name?: string | null;
  firm_name?: string | null;
  is_vip?: boolean | null;
  error?: string;
};

export async function verifyAccess(mobile: string): Promise<AccessResponse> {
  const m = normalizeMobile(mobile);
  const device_id = getDeviceId();
  try {
    const { data, error } = await rbSupabase.rpc("verify_customer_access", {
      p_mobile: m,
      p_device_id: device_id,
    });
    if (error) {
      return { ok: false, access: "error", error: error.message || "RPC error" };
    }
    const resp = (data ?? {}) as AccessResponse;
    if (!resp || typeof resp !== "object" || !resp.access) {
      return { ok: false, access: "error", error: "Unexpected response from server" };
    }
    return resp;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, access: "error", error: msg || "Unable to connect. Please try again." };
  }
}

export async function registerDevice(
  mobile: string,
  device_name?: string,
) {
  const m = normalizeMobile(mobile);
  const device_id = getDeviceId();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;
  const { data, error } = await rbSupabase.rpc("register_customer_device", {
    p_mobile: m,
    p_device_id: device_id,
    p_device_name: device_name ?? null,
    p_user_agent: ua,
    p_push_token: null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; customer_id?: string; device_approved?: boolean; error?: string };
}

export type RegisterInput = {
  mobile: string;
  name: string;
  firm_name?: string;
  gst_no?: string;
  city?: string;
  state?: string;
};

export async function registerCustomer(input: RegisterInput) {
  const m = normalizeMobile(input.mobile);
  const { data, error } = await rbSupabase.rpc("register_customer_request", {
    p_mobile: m,
    p_name: input.name ?? null,
    p_firm_name: input.firm_name ?? null,
    p_gst_no: input.gst_no ?? null,
    p_city: input.city ?? null,
    p_state: input.state ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; customer_id?: string; status?: string; error?: string };
}