import { rbSupabase } from "@/integrations/rb-supabase/client";

export type BankRow = {
  id: string;
  label: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_no: string | null;
  ifsc: string | null;
  branch: string | null;
  upi_id: string | null;
  gst_no: string | null;
  is_active: boolean | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function fetchActiveBanks(): Promise<BankRow[]> {
  const { data, error } = await rbSupabase
    .from("bank_settings")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BankRow[];
}
