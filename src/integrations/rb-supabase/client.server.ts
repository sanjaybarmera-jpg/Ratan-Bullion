import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.RB_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.RB_SUPABASE_SERVICE_ROLE_KEY ?? "";

export const RB_ADMIN_CONFIGURED = Boolean(url) && Boolean(serviceRoleKey);

// Safe log — never print the service role key value.
console.log("[rb-admin] client configured:", RB_ADMIN_CONFIGURED, {
  hasUrl: Boolean(url),
  hasServiceRoleKey: Boolean(serviceRoleKey),
});

let _client: SupabaseClient | null = null;
if (RB_ADMIN_CONFIGURED) {
  _client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function missingConfigError(): Error {
  const missing = [
    !url ? "RB_SUPABASE_URL" : null,
    !serviceRoleKey ? "RB_SUPABASE_SERVICE_ROLE_KEY" : null,
  ].filter(Boolean).join(", ");
  return new Error(
    `Supabase admin client not configured. Missing server env: ${missing}. ` +
    `Set these in project secrets so admin writes (e.g. Push Update) can reach the database.`,
  );
}

// Proxy throws a clear error on any access if env vars are missing,
// instead of silently constructing a broken client with empty URL/key.
export const rbSupabaseAdmin: SupabaseClient = (_client ?? new Proxy({}, {
  get() { throw missingConfigError(); },
  apply() { throw missingConfigError(); },
})) as SupabaseClient;

export const RB_ADMIN_URL = url;