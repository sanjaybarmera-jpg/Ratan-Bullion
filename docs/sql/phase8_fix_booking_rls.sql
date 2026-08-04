-- Phase 8: allow anon/authenticated to read global_booking_enabled.
-- Root cause of "Booking is temporarily closed" while DB row is true:
-- app_settings_select_public policy whitelisted only rate/ticker/phone
-- keys, so the customer anon client got data=null and the kill-switch
-- failed CLOSED.
drop policy if exists app_settings_select_public on public.app_settings;
create policy app_settings_select_public on public.app_settings
  for select to anon, authenticated
  using (id in (
    'usd_gold','usd_silver','usd_inr',
    'ticker_text','contact_phone','dealer_phone','whatsapp_phone',
    'global_booking_enabled',
    'payment_qr_url','qr_code_url',
    'firm2_name','firm2_type','firm2_phone','firm2_business_type',
    'firm3_name','firm3_type','firm3_phone','firm3_business_type'
  ));
