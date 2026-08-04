import { rbSupabase } from "@/integrations/rb-supabase/client";

export type NewsRow = {
  id: string;
  title: string | null;
  description: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function fetchActiveNews(): Promise<NewsRow[]> {
  const { data, error } = await rbSupabase
    .from("news")
    .select("id, title, description, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as NewsRow[];
}
