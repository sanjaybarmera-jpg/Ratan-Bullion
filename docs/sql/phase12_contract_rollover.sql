-- phase12: contract rollover columns on public.rates
-- Adds columns to persist the currently-active MCX futures contract per rate row.
-- Populated by the pull-live-rates Edge Function on every successful pull.
-- Idempotent — safe to re-run.

alter table public.rates
  add column if not exists contract_symbol text,
  add column if not exists contract_month  text,
  add column if not exists expiry_date     date;

create index if not exists rates_expiry_date_idx on public.rates (expiry_date);