-- =============================================================
-- Ratan Bullion — Phase 3
-- Secure order RPCs + RLS hardening.
-- Run this in the Supabase SQL editor for project tbgqovfgtuilgdtrmaxe.
-- Safe to re-run (uses IF EXISTS / OR REPLACE).
-- =============================================================

-- -------------------------------------------------------------
-- 1. orders.status check constraint -> uppercase canonical set
-- -------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.orders drop constraint %I', r.conname);
  end loop;
end$$;

update public.orders set status = upper(status) where status is not null;
update public.orders set status = 'PENDING'   where status in ('pending');
update public.orders set status = 'CONFIRMED' where status in ('APPROVED','approved','ACCEPTED','accepted');
update public.orders set status = 'COMPLETED' where status in ('completed');
update public.orders set status = 'REJECTED'  where status in ('rejected');
update public.orders set status = 'CANCELLED' where status in ('cancelled','CANCELED');

alter table public.orders
  add constraint orders_status_check
  check (status in ('PENDING','CONFIRMED','REJECTED','COMPLETED','CANCELLED'));

alter table public.orders alter column status set default 'PENDING';

-- -------------------------------------------------------------
-- 2. Optional FK orders.customer_id -> customers.id (NOT VALID
--    so existing NULL/orphan rows don't break)
-- -------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_customer_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_customer_id_fkey
      foreign key (customer_id) references public.customers(id)
      on update cascade on delete set null
      not valid;
  end if;
end$$;

-- -------------------------------------------------------------
-- 3. Helper: normalize Indian mobile to last 10 digits
-- -------------------------------------------------------------
create or replace function public._rb_norm_mobile(p text)
returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p,''), '\D', '', 'g'), 10)
$$;

-- -------------------------------------------------------------
-- 4. place_customer_order RPC
-- -------------------------------------------------------------
create or replace function public.place_customer_order(
  p_mobile        text,
  p_device_id     text,
  p_product       text,
  p_order_type    text,
  p_quantity      numeric,
  p_rate          numeric,
  p_total_amount  numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile text := public._rb_norm_mobile(p_mobile);
  v_cust   public.customers%rowtype;
  v_dev_ok boolean;
  v_order  public.orders%rowtype;
begin
  if v_mobile is null or length(v_mobile) <> 10 then
    return jsonb_build_object('success', false, 'message', 'Invalid mobile');
  end if;
  if coalesce(p_device_id,'') = '' then
    return jsonb_build_object('success', false, 'message', 'Invalid device');
  end if;
  if coalesce(trim(p_product),'') = '' or coalesce(trim(p_order_type),'') = '' then
    return jsonb_build_object('success', false, 'message', 'Product and order type required');
  end if;
  if coalesce(p_quantity,0) <= 0 or coalesce(p_rate,0) <= 0 or coalesce(p_total_amount,0) <= 0 then
    return jsonb_build_object('success', false, 'message', 'Quantity, rate and total must be positive');
  end if;

  select * into v_cust
  from public.customers
  where public._rb_norm_mobile(mobile) = v_mobile
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Customer not found');
  end if;
  if coalesce(v_cust.is_active, false) = false then
    return jsonb_build_object('success', false, 'message', 'Customer not active');
  end if;

  select coalesce(bool_or(coalesce(is_approved,false)), false) into v_dev_ok
  from public.customer_devices
  where public._rb_norm_mobile(mobile) = v_mobile
    and device_id = p_device_id;

  if not v_dev_ok then
    return jsonb_build_object('success', false, 'message', 'Device not approved');
  end if;

  insert into public.orders(
    customer_id, customer_name, customer_mobile,
    product, order_type, quantity, rate, total_amount, status
  ) values (
    v_cust.id, v_cust.name, v_cust.mobile,
    trim(p_product), upper(trim(p_order_type)),
    p_quantity, p_rate, p_total_amount, 'PENDING'
  )
  returning * into v_order;

  return jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'message', 'Order placed'
  );
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end$$;

revoke all on function public.place_customer_order(text,text,text,text,numeric,numeric,numeric) from public;
grant execute on function public.place_customer_order(text,text,text,text,numeric,numeric,numeric) to anon, authenticated;

-- -------------------------------------------------------------
-- 5. get_customer_orders RPC
-- -------------------------------------------------------------
create or replace function public.get_customer_orders(
  p_mobile    text,
  p_device_id text
) returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile text := public._rb_norm_mobile(p_mobile);
  v_cust   public.customers%rowtype;
  v_dev_ok boolean;
begin
  if v_mobile is null or length(v_mobile) <> 10 or coalesce(p_device_id,'') = '' then
    return;
  end if;

  select * into v_cust from public.customers
  where public._rb_norm_mobile(mobile) = v_mobile limit 1;
  if not found or coalesce(v_cust.is_active,false) = false then return; end if;

  select coalesce(bool_or(coalesce(is_approved,false)),false) into v_dev_ok
  from public.customer_devices
  where public._rb_norm_mobile(mobile) = v_mobile and device_id = p_device_id;
  if not v_dev_ok then return; end if;

  return query
    select * from public.orders
    where public._rb_norm_mobile(customer_mobile) = v_mobile
    order by created_at desc
    limit 500;
end$$;

revoke all on function public.get_customer_orders(text,text) from public;
grant execute on function public.get_customer_orders(text,text) to anon, authenticated;

-- =============================================================
-- 6. RLS hardening — drop unsafe testing policies, add safe ones.
-- =============================================================

-- customers
alter table public.customers enable row level security;
drop policy if exists customers_select_all on public.customers;
drop policy if exists customers_insert_testing on public.customers;
drop policy if exists customers_update_testing on public.customers;
drop policy if exists customers_delete_testing on public.customers;
drop policy if exists customers_insert_register on public.customers;
-- No anon SELECT/INSERT/UPDATE/DELETE. All access via SECURITY DEFINER RPCs
-- (register_customer_request, verify_customer_access) and service role admin.

-- customer_devices
alter table public.customer_devices enable row level security;
drop policy if exists customer_devices_select_all on public.customer_devices;
drop policy if exists customer_devices_insert_testing on public.customer_devices;
drop policy if exists customer_devices_update_testing on public.customer_devices;
drop policy if exists customer_devices_delete_testing on public.customer_devices;
drop policy if exists customer_devices_insert_self on public.customer_devices;
-- Device registration goes through SECURITY DEFINER RPC register_customer_device.

-- orders
alter table public.orders enable row level security;
drop policy if exists orders_select_all on public.orders;
drop policy if exists orders_insert_testing on public.orders;
drop policy if exists orders_insert_testing_admin on public.orders;
drop policy if exists orders_update_testing_admin on public.orders;
drop policy if exists orders_delete_testing_admin on public.orders;
drop policy if exists orders_insert_vip_booking_enabled on public.orders;
-- Customer reads/writes go through get_customer_orders / place_customer_order.
-- Admin uses service role.

-- admin_security
alter table public.admin_security enable row level security;
drop policy if exists admin_security_select_all on public.admin_security;
drop policy if exists admin_security_insert_testing_admin on public.admin_security;
drop policy if exists admin_security_update_testing_admin on public.admin_security;
drop policy if exists admin_security_delete_testing_admin on public.admin_security;
-- No anon access. PIN verification happens server-side via service role.

-- admin_sessions
alter table public.admin_sessions enable row level security;
drop policy if exists admin_sessions_select_all on public.admin_sessions;
drop policy if exists admin_sessions_insert_testing on public.admin_sessions;
drop policy if exists admin_sessions_update_testing on public.admin_sessions;
drop policy if exists admin_sessions_delete_testing on public.admin_sessions;

-- rates  (public read, no anon write)
alter table public.rates enable row level security;
drop policy if exists rates_insert_testing_admin on public.rates;
drop policy if exists rates_update_testing_admin on public.rates;
drop policy if exists rates_delete_testing_admin on public.rates;
drop policy if exists rates_public_read on public.rates;
drop policy if exists rates_select_all on public.rates;
drop policy if exists rates_select_public on public.rates;
create policy rates_select_public on public.rates
  for select to anon, authenticated using (true);

-- bank_settings (public read of active rows)
alter table public.bank_settings enable row level security;
drop policy if exists bank_settings_insert_testing on public.bank_settings;
drop policy if exists bank_settings_update_testing on public.bank_settings;
drop policy if exists bank_settings_delete_testing on public.bank_settings;
drop policy if exists bank_public_read on public.bank_settings;
drop policy if exists bank_settings_select_public on public.bank_settings;
create policy bank_settings_select_public on public.bank_settings
  for select to anon, authenticated using (coalesce(is_active, true) = true);

-- news (public read of active)
alter table public.news enable row level security;
drop policy if exists news_insert_admin_testing on public.news;
drop policy if exists news_update_admin_testing on public.news;
drop policy if exists news_delete_admin_testing on public.news;
drop policy if exists news_insert_testing on public.news;
drop policy if exists news_update_testing on public.news;
drop policy if exists news_delete_testing on public.news;
drop policy if exists news_public_read on public.news;
drop policy if exists news_select_active on public.news;
drop policy if exists news_select_public on public.news;
create policy news_select_public on public.news
  for select to anon, authenticated using (coalesce(is_active, true) = true);

-- app_settings (public read only; writes via service role admin)
alter table public.app_settings enable row level security;
drop policy if exists app_settings_insert_testing_admin on public.app_settings;
drop policy if exists app_settings_update_testing_admin on public.app_settings;
drop policy if exists app_settings_delete_testing_admin on public.app_settings;
drop policy if exists app_settings_public_read on public.app_settings;
drop policy if exists app_settings_select_all on public.app_settings;
drop policy if exists app_settings_select_public on public.app_settings;
create policy app_settings_select_public on public.app_settings
  for select to anon, authenticated
  using (id in (
    'usd_gold','usd_silver','usd_inr',
    'ticker_text','contact_phone','dealer_phone'
  ));

-- settings (public read only; writes via service role admin)
alter table public.settings enable row level security;
drop policy if exists settings_insert_testing_admin on public.settings;
drop policy if exists settings_update_testing_admin on public.settings;
drop policy if exists settings_delete_testing_admin on public.settings;
drop policy if exists settings_public_read on public.settings;
drop policy if exists settings_select_all on public.settings;
drop policy if exists settings_select_public on public.settings;
-- No SELECT policy: anon/authenticated cannot read; service role bypasses RLS.

-- bookings (legacy, keep table, deny anon)
alter table public.bookings enable row level security;
drop policy if exists bookings_select_all on public.bookings;
drop policy if exists bookings_insert_testing on public.bookings;
drop policy if exists bookings_update_testing on public.bookings;
drop policy if exists bookings_delete_testing on public.bookings;

-- Reload PostgREST schema cache so new RPC signatures are visible immediately
notify pgrst, 'reload schema';

-- =============================================================
-- Done. Service role (admin server-fn) bypasses RLS and continues
-- to read/write everything as before.
-- =============================================================