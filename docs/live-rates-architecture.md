# Live Rates Architecture — RB Live Engine

Rates are pushed into Supabase by **RB Live Engine**, an external service that
owns the broker connection. The app never fetches rates from a provider and
there is **no** Supabase Edge Function involved anymore.

```text
  Broker feed  ──▶  RB Live Engine  ──(service_role)──▶  Supabase
                                                          rates
                                                          rates_history
                                                          market_candles
                                                          rates_health
                                                             │ realtime
                                                             ▼
                                                        Web app (anon, read-only)
```

## What was removed

| Removed | Replacement |
| --- | --- |
| `supabase/functions/pull-live-rates` | RB Live Engine writes `rates` directly |
| `supabase/functions/discover-angel-tokens` | RB Live Engine resolves its own contracts |
| `pg_cron` job `pull-live-rates` + self-loop | RB Live Engine's own scheduler |
| `app_settings.angel_one_jwt` and `provider_*` keys | Credentials live inside RB Live Engine |

Run `docs/sql/phase17_decommission_pull_live_rates.sql` once on the RB Supabase
project to drop the cron job, purge the broker keys and confirm realtime +
service_role grants.

## Database contract (unchanged)

`rates`, `rates_history` and `market_candles` keep their existing columns.
RB Live Engine must:

1. `upsert` rows `gold` and `silver` in `public.rates` (`mcx_ltp`, `high`,
   `low`, `open`, `close`, contract-rollover columns, `updated_at = now()`).
2. Append tick rows to `public.rates_history`.
3. Maintain OHLC rows in `public.market_candles`.
4. Update `public.rates_health` row `id = 'rb-live-engine'`
   (`last_successful_fetch`, `status`, `last_error`, `consecutive_failures`).

Downstream triggers already recalculate product rates on `rates` writes, so no
extra call is needed.

## Credentials for RB Live Engine

Point the engine at the RB Supabase project with:

- `SUPABASE_URL` — same value as this project's `RB_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — same value as `RB_SUPABASE_SERVICE_ROLE_KEY`

Service role bypasses RLS, so no extra policies are required for writes. The
web app continues to read with the anon key through the existing public read
policies.

## Frontend (unchanged)

`src/lib/rb-rates.ts` reads `rates` and subscribes to Postgres changes; the
admin rate controls still write through the existing server functions. Nothing
in the UI or business logic changed with this migration.
