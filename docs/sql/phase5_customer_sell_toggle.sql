-- Add per-product customer SELL toggle.
-- is_available remains the overall stock/booking flag.
-- customer_sell_enabled additionally controls customer SELL orders.
-- Premium/spread are calculation-only and never gate booking.

ALTER TABLE public.rates
  ADD COLUMN IF NOT EXISTS customer_sell_enabled boolean NOT NULL DEFAULT true;

-- Base MCX rows (gold, silver) are unaffected; flag is ignored for them.
UPDATE public.rates
   SET customer_sell_enabled = COALESCE(customer_sell_enabled, true);