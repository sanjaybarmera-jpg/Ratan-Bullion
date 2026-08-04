-- Auto-calculate final rate columns on the `rates` table.
--
-- Replit / market feed only updates raw MCX values on the base rows
-- (id = 'gold' and id = 'silver'):
--     mcx_ltp, mcx_high, mcx_low, updated_at
--
-- Every product row (gold_999, gold_9930, silver_999, silver_98 and their
-- *_rtgs variants, identified by metal_type) derives its final columns
-- from its parent base row + its own premium and spread, using the
-- single business formula:
--
--     sell_price = mcx_ltp  + COALESCE(premium, 0)
--     buy_price  = sell_price - COALESCE(spread, 0)
--     high       = mcx_high + COALESCE(premium, 0)
--     low        = mcx_low  + COALESCE(premium, 0)
--
-- Rows where metal_type IS NULL are ignored.

-- Helper: returns the base row id ('gold' / 'silver') for a given metal_type.
create or replace function public.rb_base_id_for_metal(_metal text)
returns text
language sql
immutable
as $$
  select case
    when _metal is null then null
    when upper(_metal) like 'GOLD%'   then 'gold'
    when upper(_metal) like 'SILVER%' then 'silver'
    else null
  end
$$;

-- Trigger fn for product rows: recalc using own premium/spread + parent base MCX.
create or replace function public.rb_recalc_product_row()
returns trigger
language plpgsql
as $$
declare
  base_id text;
  base_ltp  numeric;
  base_high numeric;
  base_low  numeric;
  prem numeric;
  sprd numeric;
begin
  if new.metal_type is null then
    return new;
  end if;

  base_id := public.rb_base_id_for_metal(new.metal_type);
  if base_id is null then
    return new;
  end if;

  -- Skip the base rows themselves (gold / silver) — they hold raw MCX only.
  if new.id = base_id then
    return new;
  end if;

  select mcx_ltp, high, low
    into base_ltp, base_high, base_low
    from public.rates
   where id = base_id;

  prem := coalesce(new.premium, 0);
  sprd := coalesce(new.spread, 0);

  new.sell_price := case when base_ltp  is null then null else base_ltp  + prem end;
  new.buy_price  := case when new.sell_price is null then null else new.sell_price - sprd end;
  new.high       := case when base_high is null then null else base_high + prem end;
  new.low        := case when base_low  is null then null else base_low  + prem end;

  return new;
end;
$$;

drop trigger if exists rb_rates_product_recalc on public.rates;
create trigger rb_rates_product_recalc
-- Guard every pricing-column write, not only premium/spread edits. This makes
-- it impossible for a later family sync or live-tick writer to replace a
-- product's session H/L with raw MCX H/L or current LTP-derived values.
before insert or update of premium, spread, metal_type, mcx_ltp, buy_price, sell_price, high, low on public.rates
for each row
execute function public.rb_recalc_product_row();

-- Trigger fn for base rows: when raw MCX changes, recalc every product row
-- that belongs to that base (gold or silver).
create or replace function public.rb_recalc_children_on_base_update()
returns trigger
language plpgsql
as $$
declare
  base_id text := new.id;
  prefix text;
begin
  if base_id not in ('gold', 'silver') then
    return new;
  end if;

  if new.mcx_ltp is not distinct from old.mcx_ltp
     and new.high is not distinct from old.high
     and new.low  is not distinct from old.low then
    return new;
  end if;

  prefix := case when base_id = 'gold' then 'GOLD%' else 'SILVER%' end;

  update public.rates p
     set sell_price = case when new.mcx_ltp is null then null
                           else new.mcx_ltp + coalesce(p.premium, 0) end,
         buy_price  = case when new.mcx_ltp is null then null
                           else new.mcx_ltp + coalesce(p.premium, 0)
                                - coalesce(p.spread, 0) end,
         high       = case when new.high is null then null
                           else new.high + coalesce(p.premium, 0) end,
         low        = case when new.low  is null then null
                           else new.low  + coalesce(p.premium, 0) end,
         updated_at = now()
   where p.metal_type is not null
     and p.id <> base_id
     and upper(p.metal_type) like prefix;

  return new;
end;
$$;

drop trigger if exists rb_rates_base_recalc on public.rates;
create trigger rb_rates_base_recalc
after update of mcx_ltp, high, low on public.rates
for each row
when (new.id in ('gold', 'silver'))
execute function public.rb_recalc_children_on_base_update();

-- One-time backfill so existing rows reflect the formula immediately.
update public.rates p
   set sell_price = case when b.mcx_ltp is null then null
                         else b.mcx_ltp + coalesce(p.premium, 0) end,
       buy_price  = case when b.mcx_ltp is null then null
                         else b.mcx_ltp + coalesce(p.premium, 0)
                              - coalesce(p.spread, 0) end,
       high       = case when b.high is null then null
                         else b.high + coalesce(p.premium, 0) end,
       low        = case when b.low  is null then null
                         else b.low  + coalesce(p.premium, 0) end,
       updated_at = now()
  from public.rates b
 where p.metal_type is not null
   and b.id = public.rb_base_id_for_metal(p.metal_type)
   and p.id <> b.id;