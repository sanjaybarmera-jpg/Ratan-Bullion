-- phase13: market_candles table + 1m OHLC aggregation
-- Idempotent. Powers TradingView Lightweight Charts.

create table if not exists public.market_candles (
  id          uuid primary key default gen_random_uuid(),
  metal_type  text not null,
  timeframe   text not null,
  candle_time timestamptz not null,
  open        numeric not null,
  high        numeric not null,
  low         numeric not null,
  close       numeric not null,
  provider    text,
  created_at  timestamptz not null default now(),
  unique (metal_type, timeframe, candle_time)
);

create index if not exists market_candles_metal_tf_time_idx
  on public.market_candles (metal_type, timeframe, candle_time desc);

grant select on public.market_candles to anon, authenticated;
grant all    on public.market_candles to service_role;

alter table public.market_candles enable row level security;

drop policy if exists "market_candles public read" on public.market_candles;
create policy "market_candles public read"
  on public.market_candles for select
  to anon, authenticated
  using (true);