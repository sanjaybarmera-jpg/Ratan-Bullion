-- Phase 9 — global_booking_enabled becomes a native boolean.
--
-- Single source of truth: app_settings.value (boolean) where id =
-- 'global_booking_enabled'. value_text is no longer read or written for
-- this key. Anything other than an explicit TRUE blocks booking.

-- 1) Ensure a boolean `value` column exists on app_settings.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS value boolean;

-- 2) Seed/repair the canonical row. Preserve current state: if value_text
--    currently parses to true, keep value=true; otherwise default to true
--    (matches original phase6 seed which set the row to 'true').
INSERT INTO public.app_settings (id, value, value_text, updated_at)
VALUES ('global_booking_enabled', true, NULL, NOW())
ON CONFLICT (id) DO UPDATE
  SET value = COALESCE(
        public.app_settings.value,
        lower(trim(COALESCE(public.app_settings.value_text, ''))) IN ('true','1','on','yes')
      ),
      value_text = NULL,
      updated_at = NOW();

-- 3) Explicit cleanup per requirement.
UPDATE public.app_settings
   SET value_text = NULL
 WHERE id = 'global_booking_enabled';

-- 4) RPC: read native boolean column. Fail closed on NULL/false.
CREATE OR REPLACE FUNCTION public.place_customer_order(
  p_mobile      text,
  p_device_id   text,
  p_product     text,
  p_order_type  text,
  p_quantity    numeric,
  p_rate        numeric,
  p_total_amount numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_result  jsonb;
BEGIN
  SELECT value INTO v_enabled
    FROM public.app_settings
   WHERE id = 'global_booking_enabled';

  IF v_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Booking is temporarily closed by admin.'
    );
  END IF;

  v_result := public._place_customer_order_impl(
    p_mobile, p_device_id, p_product, p_order_type,
    p_quantity, p_rate, p_total_amount
  );
  RETURN v_result;
END;
$$;