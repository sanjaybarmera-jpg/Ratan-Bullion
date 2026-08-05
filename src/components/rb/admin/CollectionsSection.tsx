import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2, Plus, Save, Trash2, Upload, ArrowLeft, ArrowUp, ArrowDown,
  ChevronRight, ImageIcon, RefreshCw, CheckSquare, Square, FolderOpen,
} from "lucide-react";
import {
  adminListJewelleryCategories,
  adminListJewelleryCollections,
  adminUpsertJewelleryCollection,
  adminDeleteJewelleryCollection,
  adminListCollectionProducts,
  adminCreateProductFromImage,
  adminReplaceProductImage,
  adminBulkUpdateJewelleryProducts,
  adminReorderJewelleryProducts,
  adminUpsertJewelleryProduct,
  adminDeleteJewelleryProduct,
} from "@/lib/rb-admin.functions";

export type Category = { id?: string; name?: string | null; is_active?: boolean | null };

export type Collection = {
  id?: string;
  category_id?: string | null;
  product_type?: string | null;
  collection_name?: string | null;
  sort_order?: number | null;
  is_active?: boolean | null;
};

type JImage = { id: string; image_url?: string | null; sort_order?: number | null };

type Product = {
  id: string;
  product_code?: string | null;
  name?: string | null;
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

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

/* ---------------- Collection editor row ---------------- */

function CollectionForm({
  token, initial, categories, productTypes, onDone,
}: {
  token: string;
  initial: Collection;
  categories: Category[];
  productTypes: string[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(adminUpsertJewelleryCollection);
  const [d, setD] = useState<Collection>(initial);

  const save = useMutation({
    mutationFn: () => upsertFn({ data: { token, row: d as Record<string, unknown> } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-jewellery-collections"] }); onDone(); },
  });

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Metal / Category">
          <select
            value={d.category_id ?? ""}
            onChange={(e) => setD({ ...d, category_id: e.target.value || null })}
            className={inputCls}
          >
            <option value="">— Select —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Product Type">
          <input
            list="rb-product-types"
            value={d.product_type ?? ""}
            onChange={(e) => setD({ ...d, product_type: e.target.value })}
            placeholder="Payal, Ring…"
            className={inputCls}
          />
          <datalist id="rb-product-types">
            {productTypes.map((t) => <option key={t} value={t} />)}
          </datalist>
        </Field>
        <Field label="Collection Name">
          <input
            value={d.collection_name ?? ""}
            onChange={(e) => setD({ ...d, collection_name: e.target.value })}
            placeholder="Classic, Rajkot…"
            className={inputCls}
          />
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
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.is_active !== false}
            onChange={(e) => setD({ ...d, is_active: e.target.checked })}
          />
          Active
        </label>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
        <button onClick={onDone} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">
          Cancel
        </button>
      </div>
      {save.error && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}
    </div>
  );
}

/* ---------------- Products inside a collection ---------------- */

function ProductCard({
  token, p, selected, onSelect, onMove, first, last,
}: {
  token: string;
  p: Product;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(adminUpsertJewelleryProduct);
  const deleteFn = useServerFn(adminDeleteJewelleryProduct);
  const replaceFn = useServerFn(adminReplaceProductImage);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Product>(p);
  const fileRef = useRef<HTMLInputElement>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-collection-products"] });

  const img = [...(p.jewellery_images ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0];

  const save = useMutation({
    mutationFn: () => upsertFn({ data: { token, row: { ...d, jewellery_images: undefined } as Record<string, unknown> } }),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { token, id: p.id } }),
    onSuccess: invalidate,
  });
  const replace = useMutation({
    mutationFn: async (file: File) => replaceFn({
      data: {
        token, productId: p.id, fileName: file.name,
        contentType: file.type || "image/jpeg", dataBase64: await fileToBase64(file),
      },
    }),
    onSuccess: invalidate,
  });

  return (
    <div className={"rounded-lg border bg-card " + (selected ? "border-primary/60" : "border-border")}>
      <div className="flex items-center gap-2 p-2">
        <button onClick={() => onSelect(!selected)} className="text-muted-foreground hover:text-primary" aria-label="Select">
          {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
        </button>
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-background flex items-center justify-center">
          {img?.image_url ? (
            <img src={img.image_url} alt={p.product_code ?? "Product"} className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[13px] font-medium text-card-foreground">{p.product_code || "—"}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {p.net_weight ? `${p.net_weight}g net` : "no weight"}
            {p.is_active === false ? " · inactive" : ""}
          </p>
        </button>
        <div className="flex flex-col">
          <button onClick={() => onMove(-1)} disabled={first} className="p-0.5 text-muted-foreground disabled:opacity-30" aria-label="Move up">
            <ArrowUp className="h-3 w-3" />
          </button>
          <button onClick={() => onMove(1)} disabled={last} className="p-0.5 text-muted-foreground disabled:opacity-30" aria-label="Move down">
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-2 border-t border-border px-2 py-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Product Code">
              <input value={d.product_code ?? ""} onChange={(e) => setD({ ...d, product_code: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Purity">
              <input value={d.purity ?? ""} onChange={(e) => setD({ ...d, purity: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Gross Weight (g)">
              <input type="number" step="0.001" value={d.gross_weight ?? ""} onChange={(e) => setD({ ...d, gross_weight: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Net Weight (g)">
              <input type="number" step="0.001" value={d.net_weight ?? ""} onChange={(e) => setD({ ...d, net_weight: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Making Charge">
              <input value={d.making_charge ?? ""} onChange={(e) => setD({ ...d, making_charge: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Sort Order">
              <input type="number" value={d.sort_order ?? 0} onChange={(e) => setD({ ...d, sort_order: Number(e.target.value) })} className={inputCls} />
            </Field>
            <div className="col-span-2">
              <Field label="Description">
                <textarea rows={2} value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} className={inputCls} />
              </Field>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={d.is_active !== false} onChange={(e) => setD({ ...d, is_active: e.target.checked })} />
            Active
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) replace.mutate(f); e.target.value = ""; }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={replace.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {replace.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Replace image
            </button>
            <button
              onClick={() => { if (confirm("Delete this product?")) del.mutate(); }}
              disabled={del.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          </div>
          {(save.error || del.error || replace.error) && (
            <p className="text-[11px] text-destructive">
              {((save.error || del.error || replace.error) as Error).message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CollectionDetail({
  token, collection, categories, productTypes, onBack, onUnauthorized,
}: {
  token: string;
  collection: Collection;
  categories: Category[];
  productTypes: string[];
  onBack: () => void;
  onUnauthorized: () => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListCollectionProducts);
  const createFn = useServerFn(adminCreateProductFromImage);
  const bulkFn = useServerFn(adminBulkUpdateJewelleryProducts);
  const reorderFn = useServerFn(adminReorderJewelleryProducts);
  const deleteColFn = useServerFn(adminDeleteJewelleryCollection);

  const [editingInfo, setEditingInfo] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const metal = categories.find((c) => c.id === collection.category_id)?.name ?? "—";

  const q = useQuery({
    queryKey: ["admin-collection-products", collection.id],
    queryFn: async () => {
      const r: any = await listFn({ data: { token, collectionId: collection.id! } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { products: Product[] };
    },
  });

  const products = q.data?.products ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-collection-products", collection.id] });

  async function uploadFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setUploadErr(null);
    setProgress({ done: 0, total: images.length });
    for (let i = 0; i < images.length; i++) {
      try {
        const f = images[i];
        await createFn({
          data: {
            token,
            collectionId: collection.id!,
            fileName: f.name,
            contentType: f.type || "image/jpeg",
            dataBase64: await fileToBase64(f),
          },
        });
      } catch (e) {
        setUploadErr(e instanceof Error ? e.message : "Upload failed");
        break;
      }
      setProgress({ done: i + 1, total: images.length });
    }
    setProgress(null);
    invalidate();
  }

  const bulk = useMutation({
    mutationFn: (action: "activate" | "deactivate" | "delete") =>
      bulkFn({ data: { token, ids: Object.keys(sel).filter((k) => sel[k]), action } }),
    onSuccess: () => { setSel({}); invalidate(); },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderFn({ data: { token, ids } }),
    onSuccess: invalidate,
  });
  const delCol = useMutation({
    mutationFn: () => deleteColFn({ data: { token, id: collection.id! } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-jewellery-collections"] }); onBack(); },
  });

  function move(id: string, dir: -1 | 1) {
    const ids = products.map((p) => p.id);
    const idx = ids.indexOf(id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= ids.length) return;
    [ids[idx], ids[to]] = [ids[to], ids[idx]];
    reorder.mutate(ids);
  }

  const selectedCount = Object.values(sel).filter(Boolean).length;

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> All collections
      </button>

      <div className="rounded-lg border border-border bg-card p-3">
        <p className="flex flex-wrap items-center gap-1 text-[13px] font-semibold text-card-foreground">
          {metal} <ChevronRight className="h-3 w-3 text-muted-foreground" />
          {collection.product_type} <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <span className="text-primary">{collection.collection_name}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {products.length} product{products.length === 1 ? "" : "s"} ·{" "}
          {collection.is_active === false ? "Inactive" : "Active"} · sort {collection.sort_order ?? 0}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => setEditingInfo((v) => !v)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {editingInfo ? "Close" : "Collection information"}
          </button>
          <button
            onClick={() => { if (confirm("Delete this collection?")) delCol.mutate(); }}
            disabled={delCol.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" /> Delete collection
          </button>
        </div>
        {delCol.error && <p className="mt-1 text-[11px] text-destructive">{(delCol.error as Error).message}</p>}
      </div>

      {editingInfo && (
        <CollectionForm
          token={token}
          initial={collection}
          categories={categories}
          productTypes={productTypes}
          onDone={() => setEditingInfo(false)}
        />
      )}

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void uploadFiles(Array.from(e.dataTransfer.files ?? []));
        }}
        className={
          "rounded-lg border-2 border-dashed p-4 text-center " +
          (dragOver ? "border-primary bg-primary/5" : "border-border bg-background/40")
        }
      >
        <Upload className="mx-auto h-5 w-5 text-muted-foreground" />
        <p className="mt-1 text-xs text-muted-foreground">
          Drag &amp; drop product images here — each image becomes one product in{" "}
          <span className="text-foreground">{metal} → {collection.product_type} → {collection.collection_name}</span>
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { void uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={!!progress}
          className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {progress ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          {progress ? `Uploading ${progress.done}/${progress.total}` : "Upload Products"}
        </button>
        {uploadErr && <p className="mt-1 text-[11px] text-destructive">{uploadErr}</p>}
      </div>

      {/* Bulk bar */}
      {products.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
          <button
            onClick={() => {
              const all = products.every((p) => sel[p.id]);
              const next: Record<string, boolean> = {};
              if (!all) for (const p of products) next[p.id] = true;
              setSel(next);
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {products.every((p) => sel[p.id]) ? "Clear all" : "Select all"}
          </button>
          <span className="text-[11px] text-muted-foreground">{selectedCount} selected</span>
          <div className="ml-auto flex gap-1.5">
            <button
              onClick={() => bulk.mutate("activate")}
              disabled={!selectedCount || bulk.isPending}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              Activate
            </button>
            <button
              onClick={() => bulk.mutate("deactivate")}
              disabled={!selectedCount || bulk.isPending}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              Deactivate
            </button>
            <button
              onClick={() => { if (confirm(`Delete ${selectedCount} products?`)) bulk.mutate("delete"); }}
              disabled={!selectedCount || bulk.isPending}
              className="rounded-md border border-destructive/40 px-2 py-1 text-[11px] text-destructive disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        </div>
      )}
      {bulk.error && <p className="text-[11px] text-destructive">{(bulk.error as Error).message}</p>}

      {q.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : products.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No products in this collection yet.</p>
      ) : (
        <div className="space-y-1.5">
          {products.map((p, i) => (
            <ProductCard
              key={p.id}
              token={token}
              p={p}
              selected={!!sel[p.id]}
              onSelect={(v) => setSel((m) => ({ ...m, [p.id]: v }))}
              onMove={(dir) => move(p.id, dir)}
              first={i === 0}
              last={i === products.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Collections list ---------------- */

export function CollectionsSection({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const catFn = useServerFn(adminListJewelleryCategories);
  const listFn = useServerFn(adminListJewelleryCollections);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const catsQ = useQuery({
    queryKey: ["admin-jewellery-categories"],
    queryFn: async () => {
      const r: any = await catFn({ data: { token } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { categories: Category[] };
    },
  });
  const q = useQuery({
    queryKey: ["admin-jewellery-collections"],
    queryFn: async () => {
      const r: any = await listFn({ data: { token } });
      if (r?.unauthorized) { onUnauthorized(); throw new Error("Session expired"); }
      return r as { collections: Collection[]; setupRequired?: boolean };
    },
  });

  const categories = catsQ.data?.categories ?? [];
  const collections = q.data?.collections ?? [];
  const productTypes = useMemo(
    () => Array.from(new Set(collections.map((c) => (c.product_type ?? "").trim()).filter(Boolean))).sort(),
    [collections],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Collection[]>();
    for (const c of collections) {
      const metal = categories.find((x) => x.id === c.category_id)?.name ?? "Unassigned";
      const key = `${metal} → ${c.product_type ?? "—"}`;
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [collections, categories]);

  const open = collections.find((c) => c.id === openId) ?? null;
  if (open) {
    return (
      <CollectionDetail
        token={token}
        collection={open}
        categories={categories}
        productTypes={productTypes}
        onBack={() => setOpenId(null)}
        onUnauthorized={onUnauthorized}
      />
    );
  }

  return (
    <div className="space-y-2">
      {q.data?.setupRequired && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
          Collections table missing. Run <span className="font-mono">docs/sql/phase18_jewellery_collections.sql</span>{" "}
          in the database SQL editor to enable collections.
        </p>
      )}
      <button
        onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 py-1.5 text-xs text-primary hover:bg-primary/10"
      >
        <Plus className="h-3 w-3" /> {creating ? "Cancel" : "Add collection"}
      </button>
      {creating && (
        <CollectionForm
          token={token}
          initial={{ is_active: true, sort_order: 0 }}
          categories={categories}
          productTypes={productTypes}
          onDone={() => setCreating(false)}
        />
      )}

      {q.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : collections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No collections yet.</p>
      ) : (
        grouped.map(([heading, rows]) => (
          <div key={heading} className="space-y-1">
            <p className="pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{heading}</p>
            {rows.map((c) => (
              <button
                key={c.id}
                onClick={() => setOpenId(c.id!)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left hover:border-primary/40"
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-card-foreground">
                    {c.collection_name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    sort {c.sort_order ?? 0}{c.is_active === false ? " · inactive" : ""}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
