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

/* ---------- Showroom catalogue taxonomy (derived client-side) ---------- */

export const METALS = ["Gold", "Silver", "Diamond", "Platinum"] as const;
export type Metal = (typeof METALS)[number];

const PRODUCT_TYPES = [
  "Payal",
  "Ring",
  "Necklace",
  "Mangalsutra",
  "Pendant",
  "Bangles",
  "Bracelet",
  "Chain",
  "Kada",
];

const COLLECTIONS = [
  "Jodhpuri",
  "Rajkot",
  "Bombay Fancy",
  "Antique",
  "Italian",
  "Temple",
  "Lightweight",
  "Traditional",
];

function haystack(p: JewelleryProduct) {
  return `${p.name ?? ""} ${p.description ?? ""} ${p.sku ?? ""}`.toLowerCase();
}

export function productMetal(p: JewelleryProduct): Metal | null {
  const m = (p.metal ?? "").toLowerCase();
  const found = METALS.find((x) => m.includes(x.toLowerCase()));
  if (found) return found;
  const h = haystack(p);
  return METALS.find((x) => h.includes(x.toLowerCase())) ?? null;
}

export function productType(p: JewelleryProduct): string {
  const explicit = (p as { product_type?: string | null }).product_type;
  if (explicit && explicit.trim()) return explicit.trim();
  const h = haystack(p);
  return PRODUCT_TYPES.find((t) => h.includes(t.toLowerCase().replace(/s$/, ""))) ?? "Other";
}

export function productCollection(p: JewelleryProduct): string {
  const h = haystack(p);
  return COLLECTIONS.find((c) => h.includes(c.toLowerCase())) ?? "Classic";
}

export function uniqueSorted(values: string[], order: string[]): string[] {
  const set = Array.from(new Set(values));
  return set.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
}

export const PRODUCT_TYPE_ORDER = PRODUCT_TYPES;
export const COLLECTION_ORDER = COLLECTIONS;
