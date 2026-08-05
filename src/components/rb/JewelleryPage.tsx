import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Gem, Phone, MessageCircle, X, ImageIcon, ChevronRight } from "lucide-react";
import {
  fetchJewelleryProducts,
  productImages,
  productMetal,
  productType,
  productCollection,
  uniqueSorted,
  METALS,
  PRODUCT_TYPE_ORDER,
  COLLECTION_ORDER,
  type Metal,
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

const METAL_STYLE: Record<Metal, string> = {
  Gold: "from-gold/25 via-gold/10 to-transparent border-gold/40",
  Silver: "from-slate-300/20 via-slate-300/5 to-transparent border-slate-300/30",
  Diamond: "from-sky-200/20 via-sky-200/5 to-transparent border-sky-200/30",
  Platinum: "from-zinc-200/20 via-zinc-200/5 to-transparent border-zinc-200/30",
};

function Crumbs({ trail, onJump }: { trail: string[]; onJump: (level: number) => void }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      <button onClick={() => onJump(0)} className="hover:text-gold">
        Catalogue
      </button>
      {trail.map((t, i) => (
        <span key={t + i} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 opacity-50" />
          <button
            onClick={() => onJump(i + 1)}
            className={i === trail.length - 1 ? "font-semibold text-gold" : "hover:text-gold"}
          >
            {t}
          </button>
        </span>
      ))}
    </nav>
  );
}

function TileButton({
  label,
  sub,
  onClick,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-2xl border border-gold/20 bg-card px-4 py-4 text-left transition hover:border-gold/50"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold tracking-wide text-foreground">
          {label}
        </span>
        {sub && (
          <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-muted-foreground">
            {sub}
          </span>
        )}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-gold" />
    </button>
  );
}

export function JewelleryPage() {
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

  const [metal, setMetal] = useState<Metal | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [collection, setCollection] = useState<string | null>(null);
  const [selected, setSelected] = useState<JewelleryProduct | null>(null);

  const products = prodQ.data ?? [];

  const byMetal = useMemo(
    () => (metal ? products.filter((p) => productMetal(p) === metal) : []),
    [products, metal],
  );
  const types = useMemo(
    () => uniqueSorted(byMetal.map(productType), PRODUCT_TYPE_ORDER),
    [byMetal],
  );
  const byType = useMemo(
    () => (type ? byMetal.filter((p) => productType(p) === type) : []),
    [byMetal, type],
  );
  const collections = useMemo(
    () => uniqueSorted(byType.map(productCollection), COLLECTION_ORDER),
    [byType],
  );
  const shown = useMemo(
    () => (collection ? byType.filter((p) => productCollection(p) === collection) : []),
    [byType, collection],
  );

  const metalCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      const k = productMetal(p);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [products]);

  const trail = [metal, type, collection].filter(Boolean) as string[];
  const jump = (level: number) => {
    if (level === 0) {
      setMetal(null);
      setType(null);
      setCollection(null);
    } else if (level === 1) {
      setType(null);
      setCollection(null);
    } else if (level === 2) {
      setCollection(null);
    }
  };

  return (
    <section className="space-y-4 pb-6">
      <header>
        <p className="text-xs uppercase tracking-wider text-primary/80">Ratan Bullion</p>
        <h2 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
          <Gem className="h-5 w-5 text-gold" /> Jewellery Showroom
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose a metal, then a product type and collection to view designs.
        </p>
      </header>

      {trail.length > 0 && <Crumbs trail={trail} onJump={jump} />}

      {prodQ.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : prodQ.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-card p-5 text-sm text-destructive">
          Failed to load jewellery catalogue.
        </div>
      ) : !metal ? (
        <div className="grid grid-cols-2 gap-3">
          {METALS.map((m) => (
            <button
              key={m}
              onClick={() => setMetal(m)}
              className={`flex h-36 flex-col justify-end rounded-3xl border bg-gradient-to-br p-4 text-left transition hover:brightness-125 ${METAL_STYLE[m]}`}
            >
              <Gem className="mb-auto h-6 w-6 text-gold" />
              <span className="text-lg font-semibold tracking-wide text-foreground">{m}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {metalCounts.get(m) ?? 0} designs
              </span>
            </button>
          ))}
        </div>
      ) : !type ? (
        types.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            {metal} collection will be updated soon.
          </div>
        ) : (
          <div className="grid gap-2">
            {types.map((t) => (
              <TileButton
                key={t}
                label={t}
                sub={`${byMetal.filter((p) => productType(p) === t).length} designs`}
                onClick={() => setType(t)}
              />
            ))}
          </div>
        )
      ) : !collection ? (
        <div className="grid gap-2">
          {collections.map((c) => (
            <TileButton
              key={c}
              label={c}
              sub={`${byType.filter((p) => productCollection(p) === c).length} designs`}
              onClick={() => setCollection(c)}
            />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Designs coming soon.
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
          Visit our showroom or enquire directly
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

