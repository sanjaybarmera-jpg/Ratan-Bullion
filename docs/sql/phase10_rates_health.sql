-- phase10: rates_health (RB Live Engine writes rates directly)
--
-- Run this on the RB Supabase project (the one in RB_SUPABASE_URL).
-- Idempotent — safe to re-run.

-- ───────────────────────────────────────────────────────────
-- 1. Provider configuration (owned by RB Live Engine)
-- ───────────────────────────────────────────────────────────
-- Provider configuration is owned by RB Live Engine (external service).
-- No provider credentials or tokens are stored in app_settings.

-- ───────────────────────────────────────────────────────────
-- 2. rates_health monitoring table
-- ───────────────────────────────────────────────────────────
create table if not exists public.rates_health (
  id                     text primary key,
  last_successful_fetch  timestamptz,
  last_error             text,
  last_error_at          timestamptz,
  last_provider          text,
  status                 text not null default 'unknown',  -- ok | warning | degraded | unknown
  consecutive_failures   integer not null default 0,
  updated_at             timestamptz not null default now()
);

grant select on public.rates_health to authenticated, anon;
grant all    on public.rates_health to service_role;

alter table public.rates_health enable row level security;

drop policy if exists "rates_health public read" on public.rates_health;
create policy "rates_health public read"
  on public.rates_health for select
  to anon, authenticated
  using (true);

-- keep updated_at fresh
create or replace function public.rb_touch_rates_health()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_rates_health_touch on public.rates_health;
create trigger trg_rates_health_touch
before insert or update on public.rates_health
for each row execute function public.rb_touch_rates_health();

insert into public.rates_health (id, status) values ('rb-live-engine', 'unknown')
on conflict (id) do nothing;

-- ───────────────────────────────────────────────────────────
-- 3. Verify (rates are written by RB Live Engine, not by pg_cron)
-- ───────────────────────────────────────────────────────────
--   select * from public.rates_health where id = 'rb-live-engine';
--   select id, mcx_ltp, high, low, updated_at from public.rates
--     where id in ('gold','silver');
