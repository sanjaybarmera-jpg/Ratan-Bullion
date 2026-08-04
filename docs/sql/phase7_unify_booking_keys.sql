-- Phase 7 — Unify booking keys
--
-- The app uses ONLY `global_booking_enabled`. Remove legacy/stale rows
-- so admin reads/writes can't be confused.

DELETE FROM public.app_settings
 WHERE id IN ('booking_enabled', 'app_booking_enabled');

-- Ensure the canonical row exists (idempotent).
INSERT INTO public.app_settings (id, value_text, updated_at)
VALUES ('global_booking_enabled', 'true', NOW())
ON CONFLICT (id) DO NOTHING;

-- Ensure `id` is uniquely constrained so upsert(onConflict: id) works.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.app_settings'::regclass
       AND contype IN ('p','u')
       AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid='public.app_settings'::regclass
                              AND attname='id')]
  ) THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_id_key UNIQUE (id);
  END IF;
END$$;