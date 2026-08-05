import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Save, Trash2, Upload, ArrowLeft, ArrowRight, Star, ImageIcon } from "lucide-react";
import {
  adminListJewelleryCategories,
  adminUpsertJewelleryCategory,
  adminDeleteJewelleryCategory,
  adminListJewelleryProducts,
  adminUpsertJewelleryProduct,
  adminDeleteJewelleryProduct,
  adminUploadJewelleryImage,
  adminDeleteJewelleryImage,
  adminReorderJewelleryImages,
} from "@/lib/rb-admin.functions";

type Category = {
  id?: string;
  name?: string | null;
  slug?: string | null;
  image_url?: string | null;
  sort_order?: number | null;
  is_active?: boolean | null;
};

type JImage = {
  id: string;
  product_id: string;
  image_url?: string | null;
  storage_path?: string | null;
  alt_text?: string | null;
  sort_order?: number | null;
  is_active?: boolean | null;
};

type Product = {
  id?: string;
  product_code?: string | null;
  name?: string | null;
  category_id?: string | null;
  metal?: string | null;
  purity?: string | null;
  gross_weight?: number | string | null;
  net_weight?: number | string | null;
  making_charge?: string | null;
  description?: string | null;
  is_active?: boolean | null;
  sort_order?: number | null;
  jewellery_images?: JImage[] | null;
};

const inputCls =
  "mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground";
const labelCls = "text-[10px] uppercase tracking-wider text-muted-foreground";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Could not read file"));
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(file);
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

/* ---------------- Categories ---------------- */

function CategoryEditor({ token, initial, onSaved }: { token: string; initial: Category; onSaved: () => void }) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(adminUpsertJewelleryCategory);
  const deleteFn = useServerFn(adminDeleteJewelleryCategory);
  const uploadFn = useServerFn(adminUploadJewelleryImage);
  const [d, setD] = useState<Category>(initial);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: () => upsertFn({ data: { token, row: d } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-jewellery-categories"] }); onSaved(); },
  });
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { token, id: d.id! } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-jewellery-categories"] }),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const dataBase64 = await fileToBase64(file);
      return uploadFn({
        data: { token, fileName: file.name, contentType: file.type || "image/jpeg", dataBase64 },
      }) as Promise<{ url?: string }>;
    },
    onSuccess: (r) => { if (r?.url) setD((p) => ({ ...p, image_url: r.url })); },
  });

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-start gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-background flex items-center justify-center">
          {d.image_url ? (
            <img src={d.image_url} alt={d.name ?? "Category"} className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Field label="Name">
            <input value={d.name ?? ""} onChange={(e) => setD({ ...d, name: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Slug">
              <input value={d.slug ?? ""} onChange={(e) => setD({ ...d, slug: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Sort Order">
              <input
                type="number"
                value={d.sort_order ?? 0}
                onChange={(e) => setD({ ...d, sort_order: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={d.is_active !== false} onChange={(e) => setD({ ...d, is_active: e.target.checked })} />
          Active
        </label>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {upload.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Image
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
        {d.id && (
          <button
            onClick={() => { if (confirm("Delete this category?")) del.mutate(); }}
            disabled={del.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        )}
      </div>
      {(save.error || del.error || upload.error) && (
        <p className="text-xs text-destructive">
          {((save.error || del.error || upload.error) as Error).message}
        </p>
      )}
    </div>
  );
}

function CategoriesSection({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const listFn = useServerFn(adminListJewelleryCategories);
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ["admin-jewellery-categories"],
    queryFn: async () => {
      const r: any = await listFn({ data: { token } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { categories: Category[] };
    },
  });

  return (
    <div className="space-y-2">
      <button
        onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs text-primary hover:bg-primary/10"
      >
        <Plus className="h-3 w-3" /> {creating ? "Cancel" : "Add category"}
      </button>
      {creating && (
        <CategoryEditor token={token} initial={{ is_active: true, sort_order: 0 }} onSaved={() => setCreating(false)} />
      )}
      {q.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (q.data?.categories ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No categories yet.</p>
      ) : (
        q.data!.categories.map((c) => <CategoryEditor key={c.id} token={token} initial={c} onSaved={() => {}} />)
      )}
    </div>
  );
}

/* ---------------- Product images ---------------- */

function ProductImages({ token, productId, images }: { token: string; productId: string; images: JImage[] }) {
  const qc = useQueryClient();
  const uploadFn = useServerFn(adminUploadJewelleryImage);
  const deleteFn = useServerFn(adminDeleteJewelleryImage);
  const reorderFn = useServerFn(adminReorderJewelleryImages);
  const fileRef = useRef<HTMLInputElement>(null);

  const sorted = [...images].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-jewellery-products"] });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        const dataBase64 = await fileToBase64(f);
        await uploadFn({
          data: { token, productId, fileName: f.name, contentType: f.type || "image/jpeg", dataBase64 },
        });
      }
    },
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { token, id } }),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderFn({ data: { token, ids } }),
    onSuccess: invalidate,
  });

  function move(id: string, dir: -1 | 1) {
    const ids = sorted.map((i) => i.id);
    const idx = ids.indexOf(id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= ids.length) return;
    [ids[idx], ids[to]] = [ids[to], ids[idx]];
    reorder.mutate(ids);
  }
  function setMain(id: string) {
    const ids = sorted.map((i) => i.id).filter((x) => x !== id);
    reorder.mutate([id, ...ids]);
  }

  const busy = upload.isPending || del.isPending || reorder.isPending;

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2">
      <div className="flex items-center justify-between">
        <span className={labelCls}>Images ({sorted.length})</span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {upload.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) upload.mutate(files);
          e.target.value = "";
        }}
      />
      {sorted.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No images uploaded.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {sorted.map((img, i) => (
            <div key={img.id} className="relative overflow-hidden rounded-md border border-border">
              <img src={img.image_url ?? ""} alt={img.alt_text ?? "Product"} className="h-20 w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
                  MAIN
                </span>
              )}
              <div className="flex items-center justify-between gap-0.5 bg-card/90 px-1 py-0.5">
                <button onClick={() => move(img.id, -1)} disabled={busy || i === 0} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Move left">
                  <ArrowLeft className="h-3 w-3" />
                </button>
                <button onClick={() => setMain(img.id)} disabled={busy || i === 0} className="p-0.5 text-muted-foreground hover:text-primary disabled:opacity-30" aria-label="Set main">
                  <Star className="h-3 w-3" />
                </button>
                <button onClick={() => move(img.id, 1)} disabled={busy || i === sorted.length - 1} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Move right">
                  <ArrowRight className="h-3 w-3" />
                </button>
                <button onClick={() => { if (confirm("Delete this image?")) del.mutate(img.id); }} disabled={busy} className="p-0.5 text-destructive disabled:opacity-30" aria-label="Delete image">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {(upload.error || del.error || reorder.error) && (
        <p className="text-[11px] text-destructive">
          {((upload.error || del.error || reorder.error) as Error).message}
        </p>
      )}
    </div>
  );
}

/* ---------------- Products ---------------- */

function ProductEditor({
  token, initial, categories, onSaved,
}: { token: string; initial: Product; categories: Category[]; onSaved: () => void }) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(adminUpsertJewelleryProduct);
  const deleteFn = useServerFn(adminDeleteJewelleryProduct);
  const [d, setD] = useState<Product>(initial);

  const save = useMutation({
    mutationFn: () => upsertFn({ data: { token, row: { ...d, jewellery_images: undefined } } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-jewellery-products"] }); onSaved(); },
  });
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { token, id: d.id! } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-jewellery-products"] }),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Product Code">
          <input value={d.product_code ?? ""} onChange={(e) => setD({ ...d, product_code: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Product Name">
          <input value={d.name ?? ""} onChange={(e) => setD({ ...d, name: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Category">
          <select
            value={d.category_id ?? ""}
            onChange={(e) => setD({ ...d, category_id: e.target.value || null })}
            className={inputCls}
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Metal">
          <input value={d.metal ?? ""} onChange={(e) => setD({ ...d, metal: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Purity">
          <input value={d.purity ?? ""} onChange={(e) => setD({ ...d, purity: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Making Charge">
          <input value={d.making_charge ?? ""} onChange={(e) => setD({ ...d, making_charge: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Gross Weight (g)">
          <input type="number" step="0.001" value={d.gross_weight ?? ""} onChange={(e) => setD({ ...d, gross_weight: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Net Weight (g)">
          <input type="number" step="0.001" value={d.net_weight ?? ""} onChange={(e) => setD({ ...d, net_weight: e.target.value })} className={inputCls} />
        </Field>
        <div className="col-span-2">
          <Field label="Description">
            <textarea rows={2} value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} className={inputCls} />
          </Field>
        </div>
        <Field label="Sort Order">
          <input type="number" value={d.sort_order ?? 0} onChange={(e) => setD({ ...d, sort_order: Number(e.target.value) })} className={inputCls} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={d.is_active !== false} onChange={(e) => setD({ ...d, is_active: e.target.checked })} />
        Active
      </label>

      {d.id ? (
        <ProductImages token={token} productId={d.id} images={(initial.jewellery_images ?? []) as JImage[]} />
      ) : (
        <p className="text-[11px] text-muted-foreground">Save the product first to upload images.</p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
        {d.id && (
          <button
            onClick={() => { if (confirm("Delete this product and its images?")) del.mutate(); }}
            disabled={del.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        )}
      </div>
      {(save.error || del.error) && (
        <p className="text-xs text-destructive">{((save.error || del.error) as Error).message}</p>
      )}
    </div>
  );
}

function ProductsSection({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const listFn = useServerFn(adminListJewelleryProducts);
  const catFn = useServerFn(adminListJewelleryCategories);
  const [creating, setCreating] = useState(false);

  const catsQ = useQuery({
    queryKey: ["admin-jewellery-categories"],
    queryFn: async () => {
      const r: any = await catFn({ data: { token } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { categories: Category[] };
    },
  });
  const q = useQuery({
    queryKey: ["admin-jewellery-products"],
    queryFn: async () => {
      const r: any = await listFn({ data: { token } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { products: Product[] };
    },
  });

  const categories = catsQ.data?.categories ?? [];

  return (
    <div className="space-y-2">
      <button
        onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs text-primary hover:bg-primary/10"
      >
        <Plus className="h-3 w-3" /> {creating ? "Cancel" : "Add product"}
      </button>
      {creating && (
        <ProductEditor
          token={token}
          categories={categories}
          initial={{ is_active: true, sort_order: 0 }}
          onSaved={() => setCreating(false)}
        />
      )}
      {q.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (q.data?.products ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No products yet.</p>
      ) : (
        q.data!.products.map((p) => (
          <ProductEditor key={p.id} token={token} categories={categories} initial={p} onSaved={() => {}} />
        ))
      )}
    </div>
  );
}

/* ---------------- Tab shell ---------------- */

export function JewelleryTab({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [sub, setSub] = useState<"categories" | "products">("categories");

  const btn = (key: "categories" | "products", label: string) => (
    <button
      key={key}
      onClick={() => setSub(key)}
      className={
        "flex-1 rounded-md px-3 py-1.5 text-xs font-medium border " +
        (sub === key
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:text-foreground")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {btn("categories", "Categories")}
        {btn("products", "Products & Images")}
      </div>
      {sub === "categories" ? (
        <CategoriesSection token={token} onUnauthorized={onUnauthorized} />
      ) : (
        <ProductsSection token={token} onUnauthorized={onUnauthorized} />
      )}
    </div>
  );
}
