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
  storage_path?: string | null;
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_active: boolean | null;
};

export type JewelleryCollectionRef = {
  id?: string;
  product_type: string | null;
  collection_name: string | null;
};

export type JewelleryProduct = {
  id: string;
  category_id: string | null;
  collection_id: string | null;
  product_type: string | null;
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
  jewellery_collections?: JewelleryCollectionRef | null;
  jewellery_images?: JewelleryImage[] | null;
};

const CATEGORY_COLUMNS = "id,name,slug,image_url,sort_order,is_active";
const PRODUCT_COLUMNS =
  "id,category_id,collection_id,product_type,name,product_code,description,metal,purity,gross_weight,net_weight,making_charge,sku,is_active,sort_order";
const IMAGE_COLUMNS = "id,product_id,image_url,alt_text,sort_order,is_active";
const COLLECTION_COLUMNS = "product_type,collection_name";

export async function fetchJewelleryCategories(): Promise<JewelleryCategory[]> {
  const { data, error } = await rbSupabase
    .from("jewellery_categories")
    .select(CATEGORY_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as JewelleryCategory[];
}

export async function fetchJewelleryProducts(): Promise<JewelleryProduct[]> {
  const { data, error } = await rbSupabase
    .from("jewellery_products")
    .select(
      `${PRODUCT_COLUMNS}, jewellery_collections(${COLLECTION_COLUMNS}), jewellery_images(${IMAGE_COLUMNS})`,
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as JewelleryProduct[];
}

/** Gallery comes exclusively from the jewellery_images table. */
export function productImages(p: JewelleryProduct): string[] {
  const rows = (p.jewellery_images ?? [])
    .filter((i) => i.is_active !== false && Boolean(i.image_url && i.image_url.trim()))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return Array.from(new Set(rows.map((i) => i.image_url as string)));
}

/* ---------- Showroom taxonomy — driven entirely by database values ---------- */

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

/** Product Type comes from the product row, falling back to its collection's type. */
export function productType(p: JewelleryProduct): string | null {
  return clean(p.product_type) ?? clean(p.jewellery_collections?.product_type ?? null);
}

/** Collection name comes from the linked jewellery_collections row. */
export function productCollection(p: JewelleryProduct): string | null {
  return clean(p.jewellery_collections?.collection_name ?? null);
}

/** Unique, alphabetically sorted list of database values (no synthetic buckets). */
export function uniqueSorted(values: (string | null)[]): string[] {
  const set = new Set<string>();
  for (const v of values) if (v) set.add(v);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
