-- phase11: rates_history table for TradingView Lightweight Charts
-- Run on the RB Supabase project. Idempotent.

create table if not exists public.rates_history (
  id          uuid primary key default gen_random_uuid(),
  metal_type  text not null,
  ltp         numeric not null,
  open        numeric,
  high        numeric,
  low         numeric,
  close       numeric,
  provider    text,
  created_at  timestamptz not null default now()
);

create index if not exists rates_history_metal_type_idx  on public.rates_history (metal_type);
create index if not exists rates_history_created_at_idx  on public.rates_history (created_at);
create index if not exists rates_history_metal_created_idx on public.rates_history (metal_type, created_at);

grant select on public.rates_history to anon, authenticated;
grant all    on public.rates_history to service_role;

alter table public.rates_history enable row level security;

drop policy if exists "rates_history public read" on public.rates_history;
create policy "rates_history public read"
  on public.rates_history for select
  to anon, authenticated
  using (true);

-- service_role bypasses RLS; no policy needed for writes.