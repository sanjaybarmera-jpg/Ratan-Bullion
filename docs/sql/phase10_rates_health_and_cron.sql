-- phase10: rates_health + provider configuration + pg_cron schedule
--
-- Run this on the RB Supabase project (the one in RB_SUPABASE_URL).
-- Idempotent — safe to re-run.

-- ───────────────────────────────────────────────────────────
-- 1. Provider configuration (lives in existing app_settings)
-- ───────────────────────────────────────────────────────────
insert into public.app_settings (id, value_text) values
  ('rate_provider',              'ANGEL_ONE'),
  ('provider_exchange',          'MCX'),
  ('provider_symbol_gold',       ''),   -- fill via discover-angel-tokens
  ('provider_symbol_silver',     ''),   -- fill via discover-angel-tokens
  ('pull_interval_seconds',      '10'),
  ('pull_loops_per_invocation',  '6')
on conflict (id) do nothing;

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

insert into public.rates_health (id, status) values ('pull-live-rates', 'unknown')
on conflict (id) do nothing;

-- ───────────────────────────────────────────────────────────
-- 3. pg_cron schedule (every minute → function self-loops to 30s)
-- ───────────────────────────────────────────────────────────
-- Requires extensions pg_cron and pg_net. Enable in Supabase dashboard:
--   Database → Extensions → enable `pg_cron` and `pg_net`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace these BEFORE running:
--   <PROJECT_REF>        e.g. abcdxyz   (your RB Supabase project ref)
--   <CRON_SECRET>        the value you set as PULL_RATES_CRON_SECRET secret
--
-- The schedule runs every minute, 24/7. The Edge Function decides
-- internally whether to fetch (e.g. you can short-circuit it during
-- market-closed hours by reading app_settings inside pullOnce).

select cron.unschedule('pull-live-rates') where exists (
  select 1 from cron.job where jobname = 'pull-live-rates'
);

select cron.schedule(
  'pull-live-rates',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/pull-live-rates',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
  $$
);

-- ───────────────────────────────────────────────────────────
-- 4. Verify
-- ───────────────────────────────────────────────────────────
--   select * from cron.job where jobname = 'pull-live-rates';
--   select * from cron.job_run_details where jobname = 'pull-live-rates'
--     order by start_time desc limit 5;
--   select * from public.rates_health where id = 'pull-live-rates';
--   select id, mcx_ltp, high, low, updated_at from public.rates
--     where id in ('gold','silver');