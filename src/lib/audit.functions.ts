import { createServerFn } from "@tanstack/react-start";

function refFromUrl(u: string): string {
  try {
    const host = new URL(u).hostname;
    return host.split(".")[0] ?? "";
  } catch {
    return "";
  }
}

export const getServerAudit = createServerFn({ method: "GET" }).handler(async () => {
  // Server-fn runtime: reads RB_SUPABASE_URL (used by authenticated server fns
  // that act on behalf of the user via the publishable key + bearer token).
  const serverUrl = process.env.RB_SUPABASE_URL ?? "";
  // Admin runtime: same URL, paired with service-role key for elevated work.
  const adminUrl = process.env.RB_SUPABASE_URL ?? "";
  const hasServiceRole = Boolean(process.env.RB_SUPABASE_SERVICE_ROLE_KEY);

  return {
    serverUrl,
    serverRef: refFromUrl(serverUrl),
    adminUrl,
    adminRef: refFromUrl(adminUrl),
    hasServiceRole,
  };
});