import { createClient } from "@supabase/supabase-js";

const url = "https://tbgqovfgtuilgdtrmaxe.supabase.co";

const anonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiZ3FvdmZndHVpbGdkdHJtYXhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTM2MTIsImV4cCI6MjA5NDU4OTYxMn0.yb8v-le-muvPySggMQhBDmAj1rf-fs292fGtbDq884M";

export const RB_CONFIGURED = Boolean(url && anonKey);

if (!RB_CONFIGURED) {
  console.error("[rb-supabase] Missing Supabase URL or anon key.");
}

export const rbSupabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const RB_BROWSER_URL = url;
