import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { grams, inr } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pencil, Plus, Trash2, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/products")({
  head: () => ({
    meta: [
      { title: "Products — Ratan Jewellers Admin" },
      { name: "description", content: "Add, edit and remove jewellery products and pricing." },
      { property: "og:title", content: "Products — Ratan Jewellers Admin" },
      { property: "og:description", content: "Manage the jewellery catalogue and pricing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProductsPage,
});

const productSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  sku: z.string().trim().min(1, "SKU is required").max(40),
  category_id: z.string().uuid("Pick a category"),
  metal: z.string().min(1).max(20),
  purity: z.string().trim().max(20),
  weight_grams: z.number().min(0).max(100000),
  stone_details: z.string().trim().max(300),
  making_charges_pct: z.number().min(0).max(100),
  base_price: z.number().min(0).max(1000000000),
  image_url: z.string().trim().max(500),
  description: z.string().trim().max(1000),
  in_stock: z.boolean(),
  published: z.boolean(),
});

type ProductForm = z.infer<typeof productSchema>;

const emptyForm: ProductForm = {
  name: "",
  sku: "",
  category_id: "",
  metal: "gold",
  purity: "22K",
  weight_grams: 0,
  stone_details: "",
  making_charges_pct: 12,
  base_price: 0,
  image_url: "",
  description: "",
  in_stock: true,
  published: true,
};

function ProductsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [search, setSearch] = useState("");

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: products, isLoading } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, categories(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (values: ProductForm) => {
      const payload = { ...values, purity: values.purity || null };
      if (editingId) {
        const { error } = await supabase.from("products").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Product updated" : "Product added");
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product removed");
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditingId(null);
    setForm({ ...emptyForm, category_id: categories?.[0]?.id ?? "" });
    setOpen(true);
  }

  function openEdit(p: Record<string, unknown>) {
    setEditingId(p['id'] as string);
    setForm({
      name: (p['name'] as string) ?? "",
      sku: (p['sku'] as string) ?? "",
      category_id: (p['category_id'] as string) ?? "",
      metal: (p['metal'] as string) ?? "gold",
      purity: (p['purity'] as string) ?? "",
      weight_grams: Number(p['weight_grams'] ?? 0),
      stone_details: (p['stone_details'] as string) ?? "",
      making_charges_pct: Number(p['making_charges_pct'] ?? 0),
      base_price: Number(p['base_price'] ?? 0),
      image_url: (p['image_url'] as string) ?? "",
      description: (p['description'] as string) ?? "",
      in_stock: Boolean(p['in_stock']),
      published: Boolean(p['published']),
    });
    setOpen(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = productSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    save.mutate(parsed.data);
  }

  const filtered = (products ?? []).filter((p) =>
    `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="animate-rise space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="gold-text font-display text-3xl">Products</h1>
          <p className="text-sm text-muted-foreground">Catalogue, pricing and stock.</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> Add product
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or SKU"
          className="pl-9"
          maxLength={80}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading catalogue…</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p) => (
          <Card key={p.id} className="glass-panel">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-lg">{p.name}</p>
                  <p className="text-[0.7rem] tracking-wider text-muted-foreground uppercase">
                    {p.sku} · {p.categories?.name ?? "Uncategorised"}
                  </p>
                </div>
                <span className="shrink-0 text-gold">{inr(p.base_price)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="capitalize">
                  {p.metal}
                  {p.purity ? ` ${p.purity}` : ""}
                </Badge>
                <Badge variant="outline">{grams(p.weight_grams)}</Badge>
                <Badge variant="outline">MC {Number(p.making_charges_pct)}%</Badge>
                {!p.in_stock && <Badge variant="destructive">Out of stock</Badge>}
                {!p.published && <Badge variant="secondary">Draft</Badge>}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => openEdit(p)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-destructive"
                  onClick={() => remove.mutate(p.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No products match your search.</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {editingId ? "Edit product" : "New product"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input
                  id="sku"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  maxLength={40}
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category_id}
                  onValueChange={(v) => setForm({ ...form, category_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {(categories ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Metal</Label>
                <Select value={form.metal} onValueChange={(v) => setForm({ ...form, metal: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gold">Gold</SelectItem>
                    <SelectItem value="silver">Silver</SelectItem>
                    <SelectItem value="platinum">Platinum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="purity">Purity</Label>
                <Input
                  id="purity"
                  value={form.purity}
                  onChange={(e) => setForm({ ...form, purity: e.target.value })}
                  placeholder="22K"
                  maxLength={20}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="weight">Weight (g)</Label>
                <Input
                  id="weight"
                  type="number"
                  step="0.001"
                  value={form.weight_grams}
                  onChange={(e) => setForm({ ...form, weight_grams: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mc">Making charges (%)</Label>
                <Input
                  id="mc"
                  type="number"
                  step="0.1"
                  value={form.making_charges_pct}
                  onChange={(e) => setForm({ ...form, making_charges_pct: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="price">Price (INR)</Label>
                <Input
                  id="price"
                  type="number"
                  step="1"
                  value={form.base_price}
                  onChange={(e) => setForm({ ...form, base_price: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="stone">Stone details</Label>
                <Input
                  id="stone"
                  value={form.stone_details}
                  onChange={(e) => setForm({ ...form, stone_details: e.target.value })}
                  maxLength={300}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="image">Image URL</Label>
                <Input
                  id="image"
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  maxLength={500}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  maxLength={1000}
                />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.in_stock}
                  onCheckedChange={(v) => setForm({ ...form, in_stock: v })}
                />
                In stock
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.published}
                  onCheckedChange={(v) => setForm({ ...form, published: v })}
                />
                Published
              </label>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                {editingId ? "Save changes" : "Add product"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
