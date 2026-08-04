-- phase16: jewellery catalogue — images table, storage bucket, RLS policies
-- Idempotent. Safe to re-run. Does NOT touch any existing bullion tables.
-- Admin writes are performed server-side with the service_role key
-- (same model as rates / news / app_settings in phase3).

-- ---------------------------------------------------------------
-- 1. Base tables (from phase15, repeated idempotently)
-- ---------------------------------------------------------------
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
  product_code  text,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists jewellery_products_category_idx
  on public.jewellery_products (category_id, sort_order);

-- ---------------------------------------------------------------
-- 1b. Migrate away from image_url / images columns (gallery now
--     lives entirely in jewellery_images) and add product_code.
-- ---------------------------------------------------------------
alter table public.jewellery_products
  add column if not exists product_code text;

-- Backfill product_code for existing rows (RB-0001, RB-0002, ...)
update public.jewellery_products p
set product_code = coalesce(
  nullif(p.sku, ''),
  'RB-' || lpad(x.rn::text, 4, '0')
)
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.jewellery_products
) x
where x.id = p.id and (p.product_code is null or p.product_code = '');

alter table public.jewellery_products
  alter column product_code set not null;

create unique index if not exists jewellery_products_product_code_key
  on public.jewellery_products (product_code);

-- ---------------------------------------------------------------
-- 2. New: jewellery_images (one row per product image)
-- ---------------------------------------------------------------
create table if not exists public.jewellery_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.jewellery_products(id) on delete cascade,
  storage_path text,                       -- path inside the jewellery-images bucket
  image_url   text,                        -- resolved public URL
  alt_text    text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists jewellery_images_product_idx
  on public.jewellery_images (product_id, sort_order);

-- ---------------------------------------------------------------
-- 3. Grants (PostgREST needs these in addition to RLS)
-- ---------------------------------------------------------------
grant select on public.jewellery_categories to anon, authenticated;
grant all    on public.jewellery_categories to service_role;

grant select on public.jewellery_products   to anon, authenticated;
grant all    on public.jewellery_products   to service_role;

grant select on public.jewellery_images     to anon, authenticated;
grant all    on public.jewellery_images     to service_role;

-- ---------------------------------------------------------------
-- 4. RLS: public/authenticated can read ACTIVE rows only.
--    Admin writes go through service_role (bypasses RLS).
-- ---------------------------------------------------------------
alter table public.jewellery_categories enable row level security;
alter table public.jewellery_products   enable row level security;
alter table public.jewellery_images     enable row level security;

drop policy if exists "jewellery_categories public read" on public.jewellery_categories;
drop policy if exists "jewellery_categories read active" on public.jewellery_categories;
create policy "jewellery_categories read active"
  on public.jewellery_categories for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "jewellery_products public read" on public.jewellery_products;
drop policy if exists "jewellery_products read active" on public.jewellery_products;
create policy "jewellery_products read active"
  on public.jewellery_products for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "jewellery_images read active" on public.jewellery_images;
create policy "jewellery_images read active"
  on public.jewellery_images for select
  to anon, authenticated
  using (
    is_active = true
    and exists (
      select 1 from public.jewellery_products p
      where p.id = jewellery_images.product_id
        and p.is_active = true
    )
  );

-- No insert/update/delete policies: only service_role (admin server code) may write.

-- ---------------------------------------------------------------
-- 4b. Move any legacy image_url / images values into jewellery_images,
--     then drop those columns for good.
-- ---------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jewellery_products'
      and column_name = 'image_url'
  ) then
    execute $mig$
      insert into public.jewellery_images (product_id, image_url, sort_order)
      select p.id, p.image_url, 0
      from public.jewellery_products p
      where p.image_url is not null and p.image_url <> ''
        and not exists (
          select 1 from public.jewellery_images i
          where i.product_id = p.id and i.image_url = p.image_url
        )
    $mig$;
    execute 'alter table public.jewellery_products drop column image_url';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jewellery_products'
      and column_name = 'images'
  ) then
    execute $mig$
      insert into public.jewellery_images (product_id, image_url, sort_order)
      select p.id, u.url, u.ord
      from public.jewellery_products p
      cross join lateral unnest(p.images) with ordinality as u(url, ord)
      where u.url is not null and u.url <> ''
        and not exists (
          select 1 from public.jewellery_images i
          where i.product_id = p.id and i.image_url = u.url
        )
    $mig$;
    execute 'alter table public.jewellery_products drop column images';
  end if;
end $$;

-- ---------------------------------------------------------------
-- 5. Storage bucket: jewellery-images (public read)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('jewellery-images', 'jewellery-images', true)
on conflict (id) do update set public = true;

drop policy if exists "jewellery images public read" on storage.objects;
create policy "jewellery images public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'jewellery-images');

-- Uploads / deletes are performed by admin server code using the
-- service_role key, which bypasses storage RLS. No write policy needed.
