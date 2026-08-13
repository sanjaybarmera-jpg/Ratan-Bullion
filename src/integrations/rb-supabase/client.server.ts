import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Read server environment variables at request/runtime time.
// Never expose the service-role key to browser/client code.
function readEnv() {
  return {
    url: process.env.RB_SUPABASE_URL ?? "",
    serviceRoleKey: process.env.RB_SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
}

export function isRbAdminConfigured(): boolean {
  const { url, serviceRoleKey } = readEnv();
  return Boolean(url && serviceRoleKey);
}

function missingConfigError(): Error {
  const { url, serviceRoleKey } = readEnv();

  const missing = [
    !url ? "RB_SUPABASE_URL" : null,
    !serviceRoleKey ? "RB_SUPABASE_SERVICE_ROLE_KEY" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return new Error(
    `Supabase admin client not configured. Missing server env: ${missing}. ` +
      `Set these as server-side project secrets.`,
  );
}

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;

  const { url, serviceRoleKey } = readEnv();

  if (!url || !serviceRoleKey) {
    throw missingConfigError();
  }

  client = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}

// Lazy server-only proxy.
// The real Supabase client is created only when first accessed.
export const rbSupabaseAdmin: SupabaseClient = new Proxy(
  {} as SupabaseClient,
  {
    get(_target, property, receiver) {
      return Reflect.get(getClient() as object, property, receiver);
    },
  },
);

export function getRbAdminUrl(): string {
  return readEnv().url;
}
