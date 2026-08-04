-- =====================================================================
-- Ratan Bullion — Phase 2 schema migration
-- Target Supabase project ref: tbgqovfgtuilgdtrmaxe
-- Run this entire file in the Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
-- =====================================================================

-- ---------- Extensions ----------
create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------- Enums ----------
do $$ begin
  create type public.customer_status as enum ('pending','approved','blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_type as enum ('buy','sell');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('pending','confirmed','cancelled','completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.metal_kind as enum ('gold_24k','gold_22k','gold_18k','silver');
exception when duplicate_object then null; end $$;

-- ---------- updated_at trigger helper ----------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- TABLES
-- =====================================================================

-- customers
create table if not exists public.customers (
  id              uuid primary key default gen_random_uuid(),
  mobile          text not null unique,
  name            text,
  firm_name       text,
  gst_no          text,
  city            text,
  state           text,
  status          public.customer_status not null default 'pending',
  approved_at     timestamptz,
  approved_by     uuid,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists customers_status_idx on public.customers(status);
create index if not exists customers_mobile_idx on public.customers(mobile);
drop trigger if exists customers_updated_at on public.customers;
create trigger customers_updated_at
  before update on public.customers
  for each row execute function public.tg_set_updated_at();

-- customer_devices
create table if not exists public.customer_devices (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete cascade,
  device_id       text not null,
  device_name     text,
  user_agent      text,
  push_token      text,
  approved        boolean not null default false,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (customer_id, device_id)
);
create index if not exists customer_devices_customer_idx on public.customer_devices(customer_id);
drop trigger if exists customer_devices_updated_at on public.customer_devices;
create trigger customer_devices_updated_at
  before update on public.customer_devices
  for each row execute function public.tg_set_updated_at();

-- rates
create table if not exists public.rates (
  id              uuid primary key default gen_random_uuid(),
  metal           public.metal_kind not null unique,
  buy_rate        numeric(14,2) not null default 0,
  sell_rate       numeric(14,2) not null default 0,
  vip_buy_rate    numeric(14,2),
  vip_sell_rate   numeric(14,2),
  unit            text not null default 'per_10g',  -- per_10g, per_kg, per_oz
  is_open         boolean not null default true,
  updated_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists rates_updated_at on public.rates;
create trigger rates_updated_at
  before update on public.rates
  for each row execute function public.tg_set_updated_at();

-- orders
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete restrict,
  order_no        bigserial unique,
  type            public.order_type not null,
  metal           public.metal_kind not null,
  qty             numeric(14,3) not null check (qty > 0),
  unit            text not null default 'gram',
  rate            numeric(14,2) not null,
  amount          numeric(16,2) not null,
  status          public.order_status not null default 'pending',
  remarks         text,
  device_id       text,
  ip              text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  cancelled_at    timestamptz
);
create index if not exists orders_customer_idx on public.orders(customer_id);
create index if not exists orders_status_idx   on public.orders(status);
create index if not exists orders_created_idx  on public.orders(created_at desc);
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.tg_set_updated_at();

-- app_settings (key/value)
create table if not exists public.app_settings (
  key             text primary key,
  value           jsonb not null default '{}'::jsonb,
  description     text,
  updated_at      timestamptz not null default now()
);
drop trigger if exists app_settings_updated_at on public.app_settings;
create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.tg_set_updated_at();

-- bank_settings
create table if not exists public.bank_settings (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,
  bank_name       text,
  account_name    text,
  account_no      text,
  ifsc            text,
  branch          text,
  upi_id          text,
  gst_no          text,
  is_active       boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists bank_settings_active_idx on public.bank_settings(is_active, sort_order);
drop trigger if exists bank_settings_updated_at on public.bank_settings;
create trigger bank_settings_updated_at
  before update on public.bank_settings
  for each row execute function public.tg_set_updated_at();

-- news
create table if not exists public.news (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  body            text,
  image_url       text,
  is_published    boolean not null default false,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists news_published_idx on public.news(is_published, published_at desc);
drop trigger if exists news_updated_at on public.news;
create trigger news_updated_at
  before update on public.news
  for each row execute function public.tg_set_updated_at();

-- admin_security (single-row admin credentials / PIN / TOTP)
create table if not exists public.admin_security (
  id              uuid primary key default gen_random_uuid(),
  username        text not null unique,
  pin_hash        text not null,             -- bcrypt/crypt hash of admin PIN
  totp_secret     text,                       -- optional 2FA secret
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists admin_security_updated_at on public.admin_security;
create trigger admin_security_updated_at
  before update on public.admin_security
  for each row execute function public.tg_set_updated_at();

-- admin_sessions
create table if not exists public.admin_sessions (
  id              uuid primary key default gen_random_uuid(),
  admin_id        uuid not null references public.admin_security(id) on delete cascade,
  token_hash      text not null unique,
  ip              text,
  user_agent      text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz
);
create index if not exists admin_sessions_admin_idx on public.admin_sessions(admin_id);
create index if not exists admin_sessions_expires_idx on public.admin_sessions(expires_at);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

alter table public.customers         enable row level security;
alter table public.customer_devices  enable row level security;
alter table public.rates             enable row level security;
alter table public.orders            enable row level security;
alter table public.app_settings      enable row level security;
alter table public.bank_settings     enable row level security;
alter table public.news              enable row level security;
alter table public.admin_security    enable row level security;
alter table public.admin_sessions    enable row level security;

-- Default-deny model: anon/authenticated get NO direct DML.
-- All customer-facing reads/writes happen through SECURITY DEFINER RPCs below.
-- Service role (admin panel) bypasses RLS automatically.

-- Public READ for rates, bank_settings (active), news (published)
drop policy if exists "rates_public_read" on public.rates;
create policy "rates_public_read"
  on public.rates for select
  to anon, authenticated
  using (true);

drop policy if exists "bank_public_read" on public.bank_settings;
create policy "bank_public_read"
  on public.bank_settings for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "news_public_read" on public.news;
create policy "news_public_read"
  on public.news for select
  to anon, authenticated
  using (is_published = true);

-- customers / customer_devices / orders / app_settings / admin_* :
-- no anon/authenticated policies => effectively locked. Only service_role
-- and the SECURITY DEFINER RPCs below can touch them.

-- =====================================================================
-- RPC FUNCTIONS  (SECURITY DEFINER, callable via anon key)
-- =====================================================================

-- 1) register_customer_request
--    Customer submits mobile + profile. Creates row in 'pending' state,
--    or returns existing row's status if mobile already exists.
create or replace function public.register_customer_request(
  p_mobile     text,
  p_name       text default null,
  p_firm_name  text default null,
  p_gst_no     text default null,
  p_city       text default null,
  p_state      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile text := regexp_replace(coalesce(p_mobile,''), '\D', '', 'g');
  v_row    public.customers%rowtype;
begin
  if length(v_mobile) < 10 then
    return jsonb_build_object('ok', false, 'error', 'invalid_mobile');
  end if;

  select * into v_row from public.customers where mobile = v_mobile;

  if found then
    return jsonb_build_object(
      'ok', true,
      'already_exists', true,
      'customer_id', v_row.id,
      'status', v_row.status
    );
  end if;

  insert into public.customers (mobile, name, firm_name, gst_no, city, state, status)
  values (v_mobile, nullif(p_name,''), nullif(p_firm_name,''), nullif(p_gst_no,''),
          nullif(p_city,''), nullif(p_state,''), 'pending')
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'already_exists', false,
    'customer_id', v_row.id,
    'status', v_row.status
  );
end;
$$;

revoke all on function public.register_customer_request(text,text,text,text,text,text) from public;
grant execute on function public.register_customer_request(text,text,text,text,text,text)
  to anon, authenticated;

-- 2) register_customer_device
--    Binds a device fingerprint to a mobile. Device starts as not-approved;
--    admin (or auto-approval when customer is approved) flips it on.
create or replace function public.register_customer_device(
  p_mobile      text,
  p_device_id   text,
  p_device_name text default null,
  p_user_agent  text default null,
  p_push_token  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile    text := regexp_replace(coalesce(p_mobile,''), '\D', '', 'g');
  v_customer  public.customers%rowtype;
  v_device    public.customer_devices%rowtype;
begin
  if length(v_mobile) < 10 or coalesce(p_device_id,'') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select * into v_customer from public.customers where mobile = v_mobile;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'customer_not_found');
  end if;

  insert into public.customer_devices
    (customer_id, device_id, device_name, user_agent, push_token, approved, last_seen_at)
  values
    (v_customer.id, p_device_id, nullif(p_device_name,''), nullif(p_user_agent,''),
     nullif(p_push_token,''), false, now())
  on conflict (customer_id, device_id) do update
    set device_name  = coalesce(excluded.device_name, public.customer_devices.device_name),
        user_agent   = coalesce(excluded.user_agent,  public.customer_devices.user_agent),
        push_token   = coalesce(excluded.push_token,  public.customer_devices.push_token),
        last_seen_at = now()
  returning * into v_device;

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_customer.id,
    'customer_status', v_customer.status,
    'device_id', v_device.id,
    'device_approved', v_device.approved
  );
end;
$$;

revoke all on function public.register_customer_device(text,text,text,text,text) from public;
grant execute on function public.register_customer_device(text,text,text,text,text)
  to anon, authenticated;

-- 3) verify_customer_access
--    Called on app open. Returns approval state for the (mobile, device) pair.
create or replace function public.verify_customer_access(
  p_mobile    text,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile   text := regexp_replace(coalesce(p_mobile,''), '\D', '', 'g');
  v_customer public.customers%rowtype;
  v_device   public.customer_devices%rowtype;
begin
  if length(v_mobile) < 10 or coalesce(p_device_id,'') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select * into v_customer from public.customers where mobile = v_mobile;
  if not found then
    return jsonb_build_object('ok', true, 'access', 'no_customer');
  end if;

  if v_customer.status = 'blocked' then
    return jsonb_build_object('ok', true, 'access', 'blocked', 'customer_id', v_customer.id);
  end if;

  select * into v_device
    from public.customer_devices
    where customer_id = v_customer.id and device_id = p_device_id;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'access', 'device_unregistered',
      'customer_id', v_customer.id,
      'customer_status', v_customer.status
    );
  end if;

  -- Refresh last_seen_at
  update public.customer_devices set last_seen_at = now() where id = v_device.id;

  if v_customer.status = 'pending' then
    return jsonb_build_object('ok', true, 'access', 'pending_approval',
                              'customer_id', v_customer.id);
  end if;

  if v_customer.status = 'approved' and not v_device.approved then
    return jsonb_build_object('ok', true, 'access', 'device_pending',
                              'customer_id', v_customer.id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'access', 'granted',
    'customer_id', v_customer.id,
    'name', v_customer.name,
    'firm_name', v_customer.firm_name
  );
end;
$$;

revoke all on function public.verify_customer_access(text,text) from public;
grant execute on function public.verify_customer_access(text,text)
  to anon, authenticated;

-- 4) verify_admin_pin
--    Verifies admin username + PIN using pgcrypto's crypt().
--    Increments failed_attempts on miss; locks for 15 min after 5 failures.
--    On success: returns a fresh session token (caller stores hash).
create or replace function public.verify_admin_pin(
  p_username   text,
  p_pin        text,
  p_ip         text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin       public.admin_security%rowtype;
  v_token       text;
  v_token_hash  text;
  v_expires     timestamptz := now() + interval '12 hours';
begin
  if coalesce(p_username,'') = '' or coalesce(p_pin,'') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select * into v_admin from public.admin_security where username = p_username;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  if v_admin.locked_until is not null and v_admin.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked',
                              'locked_until', v_admin.locked_until);
  end if;

  if v_admin.pin_hash <> crypt(p_pin, v_admin.pin_hash) then
    update public.admin_security
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5
                               then now() + interval '15 minutes'
                               else locked_until end
     where id = v_admin.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  -- success
  v_token      := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.admin_sessions (admin_id, token_hash, ip, user_agent, expires_at)
  values (v_admin.id, v_token_hash, p_ip, p_user_agent, v_expires);

  update public.admin_security
     set failed_attempts = 0,
         locked_until    = null,
         last_login_at   = now()
   where id = v_admin.id;

  return jsonb_build_object(
    'ok', true,
    'admin_id', v_admin.id,
    'token', v_token,
    'expires_at', v_expires
  );
end;
$$;

revoke all on function public.verify_admin_pin(text,text,text,text) from public;
grant execute on function public.verify_admin_pin(text,text,text,text)
  to anon, authenticated;

-- =====================================================================
-- OPTIONAL: seed default rate rows so the app has something to read.
-- Safe / idempotent.
-- =====================================================================
insert into public.rates (metal, buy_rate, sell_rate, unit, is_open)
values
  ('gold_24k', 0, 0, 'per_10g', false),
  ('gold_22k', 0, 0, 'per_10g', false),
  ('silver',   0, 0, 'per_kg',  false)
on conflict (metal) do nothing;

-- =====================================================================
-- HOW TO CREATE THE FIRST ADMIN (run AFTER this migration):
--   insert into public.admin_security (username, pin_hash)
--   values ('admin', crypt('YOUR_PIN_HERE', gen_salt('bf', 10)));
-- =====================================================================