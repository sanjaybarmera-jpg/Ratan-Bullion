import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Gem, Phone, MessageCircle, X, ImageIcon } from "lucide-react";
import {
  fetchJewelleryCategories,
  fetchJewelleryProducts,
  productImages,
  type JewelleryProduct,
} from "@/lib/rb-jewellery";
import { fetchMarketSettings } from "@/lib/rb-rates";

function digits(s: string | null | undefined) {
  return (s ?? "").replace(/\D/g, "");
}
function waPhone(s: string | null | undefined) {
  const d = digits(s);
  if (!d) return "";
  return d.length === 10 ? "91" + d : d;
}

function ProductImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-muted/40 ${className ?? ""}`}>
        <ImageIcon className="h-6 w-6 text-muted-foreground/60" />
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" className={`object-cover ${className ?? ""}`} />;
}

function EnquiryButtons({
  wa,
  tel,
  product,
}: {
  wa: string;
  tel: string;
  product?: JewelleryProduct;
}) {
  const msg = encodeURIComponent(
    product
      ? `Hello Ratan Bullion, I am interested in: ${product.name}${product.product_code ? ` (Product Code: ${product.product_code})` : ""}. Please share details.`
      : "Hello Ratan Bullion, I would like to enquire about your jewellery collection.",
  );
  return (
    <div className="grid grid-cols-2 gap-2">
      {wa && (
        <a
          href={`https://wa.me/${wa}?text=${msg}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-semibold text-white transition hover:brightness-110"
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </a>
      )}
      {tel && (
        <a
          href={`tel:${tel}`}
          className="flex items-center justify-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2.5 text-xs font-semibold text-gold transition hover:bg-gold/20"
        >
          <Phone className="h-4 w-4" /> Call
        </a>
      )}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground text-right">{value}</span>
    </div>
  );
}

function ProductDetail({
  product,
  wa,
  tel,
  onClose,
}: {
  product: JewelleryProduct;
  wa: string;
  tel: string;
  onClose: () => void;
}) {
  const imgs = productImages(product);
  const [active, setActive] = useState(0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl border border-gold/30 bg-card p-4 pb-8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-foreground">{product.name}</h3>
            {product.product_code && (
              <p className="text-[11px] font-medium tracking-wide text-gold">
                Code {product.product_code}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full border border-border p-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ProductImage
          src={imgs[active]}
          alt={product.name}
          className="mt-3 h-64 w-full rounded-2xl border border-gold/20"
        />
        {imgs.length > 1 && (
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {imgs.map((src, i) => (
              <button
                key={src + i}
                onClick={() => setActive(i)}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border ${
                  i === active ? "border-gold" : "border-border"
                }`}
              >
                <ProductImage src={src} alt={`${product.name} ${i + 1}`} className="h-full w-full" />
              </button>
            ))}
          </div>
        )}

        {product.description && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{product.description}</p>
        )}

        <div className="mt-3 divide-y divide-border/60 rounded-2xl border border-border bg-background/40 px-3">
          <Spec label="Metal" value={product.metal} />
          <Spec label="Purity" value={product.purity} />
          <Spec
            label="Gross Wt"
            value={product.gross_weight != null ? `${product.gross_weight} g` : null}
          />
          <Spec
            label="Net Wt"
            value={product.net_weight != null ? `${product.net_weight} g` : null}
          />
          <Spec label="Making" value={product.making_charge} />
          <Spec label="Product Code" value={product.product_code} />
        </div>

        <div className="mt-4">
          <EnquiryButtons wa={wa} tel={tel} product={product} />
        </div>
      </div>
    </div>
  );
}

export function JewelleryPage() {
  const catsQ = useQuery({
    queryKey: ["rb", "jewellery", "categories"],
    queryFn: fetchJewelleryCategories,
  });
  const prodQ = useQuery({
    queryKey: ["rb", "jewellery", "products"],
    queryFn: fetchJewelleryProducts,
  });
  const settingsQ = useQuery({
    queryKey: ["rb", "market_settings"],
    queryFn: fetchMarketSettings,
    refetchInterval: 120_000,
  });

  const settings = settingsQ.data ?? {};
  const wa = waPhone(settings.whatsapp_phone || settings.dealer_phone);
  const tel = (settings.dealer_phone || settings.contact_phone || "").replace(/[^\d+]/g, "");

  const [cat, setCat] = useState<string | "all">("all");
  const [selected, setSelected] = useState<JewelleryProduct | null>(null);

  const cats = catsQ.data ?? [];
  const products = prodQ.data ?? [];
  const shown = useMemo(
    () => (cat === "all" ? products : products.filter((p) => p.category_id === cat)),
    [products, cat],
  );

  const loading = catsQ.isLoading || prodQ.isLoading;

  return (
    <section className="space-y-4 pb-6">
      <header>
        <p className="text-xs uppercase tracking-wider text-primary/80">Ratan Bullion</p>
        <h2 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
          <Gem className="h-5 w-5 text-gold" /> Jewellery
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Browse our collection and enquire directly.
        </p>
      </header>

      {cats.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setCat("all")}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition ${
              cat === "all"
                ? "border-gold bg-gold/15 text-gold"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          {cats.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition ${
                cat === c.id
                  ? "border-gold bg-gold/15 text-gold"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : prodQ.isError || catsQ.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-card p-5 text-sm text-destructive">
          Failed to load jewellery catalogue.
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Our jewellery collection will be updated soon.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {shown.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className="overflow-hidden rounded-2xl border border-gold/20 bg-card text-left transition hover:border-gold/50"
            >
              <ProductImage src={productImages(p)[0]} alt={p.name} className="h-36 w-full" />
              <div className="p-2.5">
                <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                {p.product_code && (
                  <p className="truncate text-[10px] font-medium tracking-wide text-gold">
                    {p.product_code}
                  </p>
                )}
                <p className="truncate text-[11px] text-muted-foreground">
                  {[p.metal, p.purity].filter(Boolean).join(" · ") || "Tap for details"}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-gold/20 bg-card p-4">
        <p className="mb-2.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          Enquire about our collection
        </p>
        <EnquiryButtons wa={wa} tel={tel} />
      </div>

      {selected && (
        <ProductDetail
          product={selected}
          wa={wa}
          tel={tel}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
