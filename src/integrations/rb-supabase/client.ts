import { createClient } from "@supabase/supabase-js";

const url =
  import.meta.env["VITE_RB_SUPABASE_URL"] ||
  process.env["RB_SUPABASE_URL"] ||
  "";

const publishableKey =
  import.meta.env["VITE_RB_SUPABASE_PUBLISHABLE_KEY"] ||
  process.env["RB_SUPABASE_PUBLISHABLE_KEY"] ||
  "";

export const RB_CONFIGURED = Boolean(url && publishableKey);

if (!RB_CONFIGURED) {
  console.error(
    "[rb-supabase] Missing VITE_RB_SUPABASE_URL or VITE_RB_SUPABASE_PUBLISHABLE_KEY.",
  );
}

export const rbSupabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const RB_BROWSER_URL = url;
