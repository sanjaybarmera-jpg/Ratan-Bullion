import { rbSupabase } from "@/integrations/rb-supabase/client";

export type JewelleryCategory = {
  id: string;
  name: string;
  slug: string | null;
  image_url: string | null;
  sort_order: number | null;
  is_active: boolean | null;
};

export type JewelleryImage = {
  id: string;
  product_id: string;
  storage_path: string | null;
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_active: boolean | null;
};

export type JewelleryProduct = {
  id: string;
  category_id: string | null;
  name: string;
  product_code: string;
  description: string | null;
  metal: string | null;
  purity: string | null;
  gross_weight: number | null;
  net_weight: number | null;
  making_charge: string | null;
  sku: string | null;
  is_active: boolean | null;
  sort_order: number | null;
  jewellery_images?: JewelleryImage[] | null;
};

export async function fetchJewelleryCategories(): Promise<JewelleryCategory[]> {
  const { data, error } = await rbSupabase
    .from("jewellery_categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as JewelleryCategory[];
}

export async function fetchJewelleryProducts(): Promise<JewelleryProduct[]> {
  const { data, error } = await rbSupabase
    .from("jewellery_products")
    .select("*, jewellery_images(*)")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as JewelleryProduct[];
}

/** Gallery comes exclusively from the jewellery_images table. */
export function productImages(p: JewelleryProduct): string[] {
  const rows = (p.jewellery_images ?? [])
    .filter((i) => i.is_active !== false && Boolean(i.image_url && i.image_url.trim()))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return Array.from(new Set(rows.map((i) => i.image_url as string)));
}
