import { createServerFn } from "@tanstack/react-start";
import { rbSupabaseAdmin } from "@/integrations/rb-supabase/client.server";

const FIRM_KEYS = [
  "firm2_name",
  "firm2_business_type",
  "firm2_phone",
  "firm3_name",
  "firm3_business_type",
  "firm3_phone",
] as const;

export const fetchOtherFirms = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await rbSupabaseAdmin
      .from("app_settings")
      .select("id, value_text")
      .in("id", FIRM_KEYS as unknown as string[]);
    if (error) return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const row of (data ?? []) as { id: string; value_text: string | null }[]) {
      if (row.value_text != null) out[row.id] = row.value_text;
    }
    return out;
  },
);