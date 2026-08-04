-- phase17: decommission pull-live-rates, hand rate ingestion to RB Live Engine
--
-- Run once on the RB Supabase project (the one in RB_SUPABASE_URL).
-- Idempotent — safe to re-run.
--
-- Schema is intentionally UNCHANGED: rates, rates_history and market_candles
-- keep their exact structure. Only the old self-loop/cron plumbing and the
-- broker credentials that lived in app_settings are removed.

-- ───────────────────────────────────────────────────────────
-- 1. Drop the pg_cron schedule that invoked the Edge Function
-- ───────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in ('pull-live-rates', 'pull-live-rates-selfloop');
  end if;
end$$;

-- ───────────────────────────────────────────────────────────
-- 2. Remove Angel One / provider secrets from app_settings
--    (RB Live Engine holds its own broker credentials)
-- ───────────────────────────────────────────────────────────
delete from public.app_settings
where id in (
  'angel_one_jwt',
  'angel_one_feed_token',
  'angel_one_refresh_token',
  'rate_provider',
  'provider_exchange',
  'provider_symbol_gold',
  'provider_symbol_silver',
  'pull_interval_seconds',
  'pull_loops_per_invocation'
);

-- ───────────────────────────────────────────────────────────
-- 3. Re-key the health row to the new writer
-- ───────────────────────────────────────────────────────────
insert into public.rates_health (id, status)
values ('rb-live-engine', 'unknown')
on conflict (id) do nothing;

delete from public.rates_health where id = 'pull-live-rates';

-- ───────────────────────────────────────────────────────────
-- 4. Realtime: make sure the frontend keeps receiving updates
--    written by RB Live Engine via the service_role key.
-- ───────────────────────────────────────────────────────────
do $$
begin
  begin
    alter publication supabase_realtime add table public.rates;
  exception when duplicate_object then null;
  end;
end$$;

alter table public.rates replica identity full;

-- ───────────────────────────────────────────────────────────
-- 5. Write access for RB Live Engine (service_role only).
--    anon/authenticated keep read-only access; no public writes.
-- ───────────────────────────────────────────────────────────
grant all on public.rates          to service_role;
grant all on public.rates_history  to service_role;
grant all on public.market_candles to service_role;
grant all on public.rates_health   to service_role;

-- ───────────────────────────────────────────────────────────
-- 6. Verify
-- ───────────────────────────────────────────────────────────
--   select jobname from cron.job;                       -- no pull-live-rates
--   select id from public.app_settings order by id;     -- no angel_* keys
--   select * from public.rates_health;                  -- rb-live-engine row
--   select id, mcx_ltp, high, low, updated_at from public.rates;
