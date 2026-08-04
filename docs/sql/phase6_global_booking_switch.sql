-- Phase 6 — Global booking kill-switch
--
-- Single source of truth: app_settings row with id = 'global_booking_enabled'.
-- value_text must be 'true' to allow customer orders. Anything else (missing
-- row, NULL, 'false', '0', etc.) blocks order placement.
--
-- The application (server function) re-reads this row on every order attempt
-- and fails closed. This migration adds the same guard inside the
-- place_customer_order RPC so direct DB calls are also blocked.

INSERT INTO public.app_settings (id, value_text, updated_at)
VALUES ('global_booking_enabled', 'true', NOW())
ON CONFLICT (id) DO NOTHING;

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
  v_enabled text;
  v_result  jsonb;
BEGIN
  -- Global booking kill-switch (fail closed).
  SELECT value_text INTO v_enabled
    FROM public.app_settings
   WHERE id = 'global_booking_enabled';

  IF v_enabled IS NULL
     OR lower(trim(v_enabled)) NOT IN ('true', '1', 'on', 'yes') THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Booking is temporarily closed by admin.'
    );
  END IF;

  -- Delegate to existing implementation. If your project already has
  -- place_customer_order defined elsewhere, replace this block with the
  -- original body (after the kill-switch check above).
  v_result := public._place_customer_order_impl(
    p_mobile, p_device_id, p_product, p_order_type,
    p_quantity, p_rate, p_total_amount
  );
  RETURN v_result;
END;
$$;
