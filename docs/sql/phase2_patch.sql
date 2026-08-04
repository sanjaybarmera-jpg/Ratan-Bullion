-- =====================================================================
-- Ratan Bullion — Phase 2 PATCH migration (safe / additive only)
-- Target Supabase project ref: tbgqovfgtuilgdtrmaxe
--
-- This file is SAFE TO RE-RUN. It:
--   * NEVER drops a table
--   * NEVER drops or renames a column
--   * NEVER deletes data
--   * Only uses: CREATE TABLE IF NOT EXISTS,
--                ALTER TABLE ... ADD COLUMN IF NOT EXISTS,
--                CREATE INDEX IF NOT EXISTS,
--                CREATE OR REPLACE FUNCTION,
--                DROP POLICY IF EXISTS (then CREATE POLICY),
--                DROP TRIGGER IF EXISTS (then CREATE TRIGGER).
--
-- Reuses your existing tables exactly:
--   customers, customer_devices, rates, orders, app_settings,
--   news, settings, bookings, trades, admin_security
--
-- Adds only the two missing tables:
--   bank_settings, admin_sessions
--
-- Adds a few OPTIONAL nullable columns required by the RPCs (firm_name,
-- gst_no, state, notes, updated_at on customers; user_agent, push_token,
-- updated_at on customer_devices). All are nullable with safe defaults,
-- so existing rows remain untouched and existing inserts keep working.
-- =====================================================================

-- ---------- Extensions ----------
create extension if not exists "pgcrypto";

-- ---------- updated_at helper ----------
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
-- ADDITIVE COLUMN PATCHES (all nullable / defaulted — no data rewrite)
-- =====================================================================

-- customers: extra profile + audit fields the registration RPC needs.
alter table public.customers add column if not exists firm_name   text;
alter table public.customers add column if not exists gst_no      text;
alter table public.customers add column if not exists state       text;
alter table public.customers add column if not exists notes       text;
alter table public.customers add column if not exists approved_at timestamptz;
alter table public.customers add column if not exists approved_by uuid;
alter table public.customers add column if not exists updated_at  timestamptz not null default now();

-- customer_devices: extra device metadata.
alter table public.customer_devices add column if not exists user_agent  text;
alter table public.customer_devices add column if not exists push_token  text;
alter table public.customer_devices add column if not exists updated_at  timestamptz not null default now();

-- Helpful indexes (no-ops if already present).
create index if not exists customers_mobile_idx          on public.customers(mobile);
create index if not exists customers_is_active_idx       on public.customers(is_active);
create index if not exists customer_devices_mobile_idx   on public.customer_devices(mobile);
create unique index if not exists customer_devices_mobile_device_uniq
  on public.customer_devices(mobile, device_id);
create index if not exists orders_customer_idx           on public.orders(customer_id);
create index if not exists orders_status_idx             on public.orders(status);
create index if not exists orders_created_idx            on public.orders(created_at desc);
create index if not exists news_active_idx               on public.news(is_active, created_at desc);

-- updated_at triggers (idempotent).
drop trigger if exists customers_updated_at on public.customers;
create trigger customers_updated_at
  before update on public.customers
  for each row execute function public.tg_set_updated_at();

drop trigger if exists customer_devices_updated_at on public.customer_devices;
create trigger customer_devices_updated_at
  before update on public.customer_devices
  for each row execute function public.tg_set_updated_at();

drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.tg_set_updated_at();

drop trigger if exists news_updated_at on public.news;
create trigger news_updated_at
  before update on public.news
  for each row execute function public.tg_set_updated_at();

drop trigger if exists rates_updated_at on public.rates;
create trigger rates_updated_at
  before update on public.rates
  for each row execute function public.tg_set_updated_at();

-- =====================================================================
-- NEW TABLES (only the two that are missing)
-- =====================================================================

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
create index if not exists bank_settings_active_idx
  on public.bank_settings(is_active, sort_order);
drop trigger if exists bank_settings_updated_at on public.bank_settings;
create trigger bank_settings_updated_at
  before update on public.bank_settings
  for each row execute function public.tg_set_updated_at();

-- admin_sessions
create table if not exists public.admin_sessions (
  id              uuid primary key default gen_random_uuid(),
  admin_key       text not null,                -- references admin_security.setting_key
  token_hash      text not null unique,
  ip              text,
  user_agent      text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz
);
create index if not exists admin_sessions_key_idx     on public.admin_sessions(admin_key);
create index if not exists admin_sessions_expires_idx on public.admin_sessions(expires_at);

-- =====================================================================
-- ROW LEVEL SECURITY (additive — only enables RLS + adds READ policies)
-- =====================================================================
-- We enable RLS on all tables and grant only narrow public READ on the
-- rows the customer app must see. All writes go through SECURITY DEFINER
-- RPCs below, or through service_role (admin panel) which bypasses RLS.

alter table public.customers         enable row level security;
alter table public.customer_devices  enable row level security;
alter table public.rates             enable row level security;
alter table public.orders            enable row level security;
alter table public.app_settings      enable row level security;
alter table public.news              enable row level security;
alter table public.settings          enable row level security;
alter table public.admin_security    enable row level security;
alter table public.bank_settings     enable row level security;
alter table public.admin_sessions    enable row level security;

-- Public read: live rates
drop policy if exists "rates_public_read" on public.rates;
create policy "rates_public_read"
  on public.rates for select
  to anon, authenticated
  using (true);

-- Public read: active news
drop policy if exists "news_public_read" on public.news;
create policy "news_public_read"
  on public.news for select
  to anon, authenticated
  using (is_active = true);

-- Public read: active bank entries
drop policy if exists "bank_public_read" on public.bank_settings;
create policy "bank_public_read"
  on public.bank_settings for select
  to anon, authenticated
  using (is_active = true);

-- Public read: app_settings (key/value, non-sensitive client config)
drop policy if exists "app_settings_public_read" on public.app_settings;
create policy "app_settings_public_read"
  on public.app_settings for select
  to anon, authenticated
  using (true);

-- Public read: market/maintenance flags
drop policy if exists "settings_public_read" on public.settings;
create policy "settings_public_read"
  on public.settings for select
  to anon, authenticated
  using (true);

-- customers / customer_devices / orders / admin_security / admin_sessions
-- have NO anon/authenticated policy => locked. Only service_role + the
-- SECURITY DEFINER RPCs below can touch them.

-- =====================================================================
-- RPCs (adapted to your EXISTING column names)
-- =====================================================================

-- 1) register_customer_request
--    Creates a customer row in PENDING state (is_active = false), or
--    returns the existing row's status if the mobile already exists.
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
      'is_active', v_row.is_active,
      'status', case when v_row.is_active then 'approved' else 'pending' end
    );
  end if;

  insert into public.customers
    (mobile, name, firm_name, gst_no, city, state, is_active)
  values
    (v_mobile, nullif(p_name,''), nullif(p_firm_name,''), nullif(p_gst_no,''),
     nullif(p_city,''), nullif(p_state,''), false)
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'already_exists', false,
    'customer_id', v_row.id,
    'is_active', v_row.is_active,
    'status', 'pending'
  );
end;
$$;

revoke all on function public.register_customer_request(text,text,text,text,text,text) from public;
grant execute on function public.register_customer_request(text,text,text,text,text,text)
  to anon, authenticated;

-- 2) register_customer_device
--    Binds a device fingerprint to a mobile. Device starts as not-approved.
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
    (mobile, device_id, device_name, user_agent, push_token, is_approved, last_login_at)
  values
    (v_mobile, p_device_id, nullif(p_device_name,''), nullif(p_user_agent,''),
     nullif(p_push_token,''), false, now())
  on conflict (mobile, device_id) do update
    set device_name  = coalesce(excluded.device_name, public.customer_devices.device_name),
        user_agent   = coalesce(excluded.user_agent,  public.customer_devices.user_agent),
        push_token   = coalesce(excluded.push_token,  public.customer_devices.push_token),
        last_login_at = now()
  returning * into v_device;

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_customer.id,
    'customer_active', v_customer.is_active,
    'device_id', v_device.id,
    'device_approved', v_device.is_approved
  );
end;
$$;

revoke all on function public.register_customer_device(text,text,text,text,text) from public;
grant execute on function public.register_customer_device(text,text,text,text,text)
  to anon, authenticated;

-- 3) verify_customer_access
--    Returns access state for the (mobile, device) pair.
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

  select * into v_device
    from public.customer_devices
    where mobile = v_mobile and device_id = p_device_id;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'access', 'device_unregistered',
      'customer_id', v_customer.id,
      'customer_active', v_customer.is_active
    );
  end if;

  update public.customer_devices set last_login_at = now() where id = v_device.id;

  if v_customer.is_active is not true then
    return jsonb_build_object('ok', true, 'access', 'pending_approval',
                              'customer_id', v_customer.id);
  end if;

  if v_device.is_approved is not true then
    return jsonb_build_object('ok', true, 'access', 'device_pending',
                              'customer_id', v_customer.id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'access', 'granted',
    'customer_id', v_customer.id,
    'name', v_customer.name,
    'firm_name', v_customer.firm_name,
    'is_vip', v_customer.is_vip
  );
end;
$$;

revoke all on function public.verify_customer_access(text,text) from public;
grant execute on function public.verify_customer_access(text,text)
  to anon, authenticated;

-- 4) verify_admin_pin
--    Your admin_security is a key/value table (setting_key, setting_value).
--    We store the bcrypt PIN hash under setting_key = 'admin_pin_hash:<username>'
--    and lockout state under 'admin_lock:<username>' (jsonb-as-text).
--    On success we insert a row in admin_sessions and return a fresh token.
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
  v_user        text := coalesce(p_username,'');
  v_hash_key    text := 'admin_pin_hash:' || v_user;
  v_lock_key    text := 'admin_lock:'     || v_user;
  v_pin_hash    text;
  v_lock_raw    text;
  v_lock        jsonb;
  v_failed      int  := 0;
  v_locked_until timestamptz;
  v_token       text;
  v_token_hash  text;
  v_expires     timestamptz := now() + interval '12 hours';
begin
  if v_user = '' or coalesce(p_pin,'') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select setting_value into v_pin_hash
    from public.admin_security where setting_key = v_hash_key;
  if v_pin_hash is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  select setting_value into v_lock_raw
    from public.admin_security where setting_key = v_lock_key;
  if v_lock_raw is not null then
    begin
      v_lock := v_lock_raw::jsonb;
      v_failed       := coalesce((v_lock->>'failed_attempts')::int, 0);
      v_locked_until := nullif(v_lock->>'locked_until','')::timestamptz;
    exception when others then
      v_failed := 0; v_locked_until := null;
    end;
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked',
                              'locked_until', v_locked_until);
  end if;

  if v_pin_hash <> crypt(p_pin, v_pin_hash) then
    v_failed := v_failed + 1;
    v_locked_until := case when v_failed >= 5
                           then now() + interval '15 minutes'
                           else null end;
    insert into public.admin_security (setting_key, setting_value, updated_at)
    values (v_lock_key,
            jsonb_build_object('failed_attempts', v_failed,
                               'locked_until', v_locked_until)::text,
            now())
    on conflict (setting_key) do update
      set setting_value = excluded.setting_value,
          updated_at    = now();
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;

  -- success: clear lockout, issue token
  insert into public.admin_security (setting_key, setting_value, updated_at)
  values (v_lock_key,
          jsonb_build_object('failed_attempts', 0,
                             'locked_until', null,
                             'last_login_at', now())::text,
          now())
  on conflict (setting_key) do update
    set setting_value = excluded.setting_value,
        updated_at    = now();

  v_token      := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.admin_sessions (admin_key, token_hash, ip, user_agent, expires_at)
  values (v_user, v_token_hash, p_ip, p_user_agent, v_expires);

  return jsonb_build_object(
    'ok', true,
    'admin', v_user,
    'token', v_token,
    'expires_at', v_expires
  );
end;
$$;

revoke all on function public.verify_admin_pin(text,text,text,text) from public;
grant execute on function public.verify_admin_pin(text,text,text,text)
  to anon, authenticated;

-- admin_security must have unique setting_key for the on-conflict above.
-- If it does not already, this no-ops on retries:
do $$ begin
  alter table public.admin_security add constraint admin_security_setting_key_uniq unique (setting_key);
exception
  when duplicate_table then null;
  when duplicate_object then null;
  when invalid_table_definition then null;
end $$;

-- =====================================================================
-- HOW TO CREATE THE FIRST ADMIN (run AFTER this migration):
--
--   insert into public.admin_security (setting_key, setting_value, updated_at)
--   values ('admin_pin_hash:admin',
--           crypt('YOUR_PIN_HERE', gen_salt('bf', 10)),
--           now())
--   on conflict (setting_key) do update
--     set setting_value = excluded.setting_value,
--         updated_at    = now();
-- =====================================================================