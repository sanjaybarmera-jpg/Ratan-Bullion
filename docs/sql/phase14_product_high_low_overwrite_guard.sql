-- Prevent any later writer from overwriting product High/Low with raw MCX
-- values or values derived from the current LTP.
--
-- Product pricing remains database-first:
--   high = base MCX session high + product premium
--   low  = base MCX session low  + product premium

create or replace function public.rb_recalc_product_row()
returns trigger
language plpgsql
as $$
declare
  base_id text;
  base_ltp numeric;
  base_high numeric;
  base_low numeric;
  prem numeric;
  sprd numeric;
begin
  if new.metal_type is null then
    return new;
  end if;

  base_id := public.rb_base_id_for_metal(new.metal_type);
  if base_id is null or new.id = base_id then
    return new;
  end if;

  select mcx_ltp, high, low
    into base_ltp, base_high, base_low
    from public.rates
   where id = base_id;

  prem := coalesce(new.premium, 0);
  sprd := coalesce(new.spread, 0);

  new.mcx_ltp   := base_ltp;
  new.buy_price := case when base_ltp is null then null
                        else base_ltp + prem end;
  new.sell_price := case when new.buy_price is null then null
                         else new.buy_price - sprd end;
  new.high := case when base_high is null then null
                   else base_high + prem end;
  new.low := case when base_low is null then null
                  else base_low + prem end;

  return new;
end;
$$;

drop trigger if exists rb_rates_product_recalc on public.rates;
create trigger rb_rates_product_recalc
before insert or update of premium, spread, metal_type, mcx_ltp, buy_price, sell_price, high, low
on public.rates
for each row
execute function public.rb_recalc_product_row();

-- Repair all existing product rows immediately using the same guarded path.
update public.rates
   set high = high,
       low = low
 where id not in ('gold', 'silver')
   and public.rb_base_id_for_metal(metal_type) is not null;