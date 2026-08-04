-- phase15: jewellery catalogue (categories + products)
-- Idempotent. Public read; writes via service_role / admin only.

create table if not exists public.jewellery_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  image_url   text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.jewellery_products (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid references public.jewellery_categories(id) on delete set null,
  name          text not null,
  description   text,
  metal         text,
  purity        text,
  gross_weight  numeric,
  net_weight    numeric,
  making_charge text,
  sku           text,
  image_url     text,
  images        text[],
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists jewellery_products_category_idx
  on public.jewellery_products (category_id, sort_order);

grant select on public.jewellery_categories to anon, authenticated;
grant all    on public.jewellery_categories to service_role;
grant select on public.jewellery_products   to anon, authenticated;
grant all    on public.jewellery_products   to service_role;

alter table public.jewellery_categories enable row level security;
alter table public.jewellery_products   enable row level security;

drop policy if exists "jewellery_categories public read" on public.jewellery_categories;
create policy "jewellery_categories public read"
  on public.jewellery_categories for select to anon, authenticated using (true);

drop policy if exists "jewellery_products public read" on public.jewellery_products;
create policy "jewellery_products public read"
  on public.jewellery_products for select to anon, authenticated using (true);