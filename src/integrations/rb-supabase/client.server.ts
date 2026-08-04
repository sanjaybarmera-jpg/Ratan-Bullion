import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Env must be read at call time: the Worker runtime injects env per request,
// so module-scope reads can be empty during SSR/build.
function readEnv() {
  const url = process.env.RB_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.RB_SUPABASE_SERVICE_ROLE_KEY ?? "";
  return { url, serviceRoleKey };
}

export function isRbAdminConfigured(): boolean {
  const { url, serviceRoleKey } = readEnv();
  return Boolean(url) && Boolean(serviceRoleKey);
}

/** @deprecated evaluated at import time; prefer isRbAdminConfigured() */
export const RB_ADMIN_CONFIGURED = isRbAdminConfigured();

function missingConfigError(): Error {
  const { url, serviceRoleKey } = readEnv();
  const missing = [
    !url ? "RB_SUPABASE_URL" : null,
    !serviceRoleKey ? "RB_SUPABASE_SERVICE_ROLE_KEY" : null,
  ].filter(Boolean).join(", ");
  return new Error(
    `Supabase admin client not configured. Missing server env: ${missing}. ` +
    `Set these in project secrets so admin writes (e.g. Push Update) can reach the database.`,
  );
}

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const { url, serviceRoleKey } = readEnv();
  if (!url || !serviceRoleKey) throw missingConfigError();
  _client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// Lazy proxy: resolves the real client (and env) on first property access.
export const rbSupabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop, receiver) {
    return Reflect.get(getClient() as object, prop, receiver);
  },
  apply() { throw missingConfigError(); },
});

export function getRbAdminUrl(): string {
  return readEnv().url;
}

export const RB_ADMIN_URL = readEnv().url;
