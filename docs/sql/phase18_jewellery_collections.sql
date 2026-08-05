-- Phase 18 — Jewellery Collections (Metal → Product Type → Collection → Products)
-- Run this once in the RB Supabase SQL editor.

create table if not exists public.jewellery_collections (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.jewellery_categories(id) on delete cascade,
  product_type text not null,
  collection_name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists jewellery_collections_unique
  on public.jewellery_collections (category_id, lower(product_type), lower(collection_name));

-- Products belong to a collection and inherit metal / product type from it.
alter table public.jewellery_products
  add column if not exists collection_id uuid references public.jewellery_collections(id) on delete set null,
  add column if not exists product_type text;

create index if not exists jewellery_products_collection_idx
  on public.jewellery_products (collection_id);

grant select on public.jewellery_collections to anon, authenticated;
grant all on public.jewellery_collections to service_role;

alter table public.jewellery_collections enable row level security;

drop policy if exists "collections public read" on public.jewellery_collections;
create policy "collections public read"
  on public.jewellery_collections for select
  using (is_active = true);
