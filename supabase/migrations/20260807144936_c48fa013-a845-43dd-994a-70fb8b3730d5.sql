-- 1) Restrict notifications reads by audience
DROP POLICY IF EXISTS "notifications read" ON public.notifications;
CREATE POLICY "notifications audience read"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    audience = 'all'
    OR (audience = 'staff' AND public.is_staff(auth.uid()))
    OR (audience = 'admin' AND public.has_role(auth.uid(), 'admin'::app_role))
    OR public.is_staff(auth.uid())
  );

-- 2) Trigger-only SECURITY DEFINER functions must not be callable via the API
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;