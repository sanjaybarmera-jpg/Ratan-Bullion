# Ratan Bullion — Live Rate Infrastructure

## 1. Current (broken) architecture

```text
 Angel One SmartAPI
        │
        ▼
 ┌────────────────────────┐
 │ Replit Node script     │  ← sleeps after ~15 min idle
 │ kept alive by a tab    │
 └──────────┬─────────────┘
            │ supabase-js upsert
            ▼
      Supabase `rates` table
            │
   ┌────────┴────────┐
   ▼                 ▼
 Web app           Android APK
 (read-only)       (read-only)
```

**Root cause of frozen rates:** the writer is a long-lived process running in
a free-tier Replit container that pauses when no browser is holding it open.
No browser tab → no fetch loop → no new rows → APK shows stale prices.

## 2. New (production) architecture

```text
        Any rate provider           (today: Angel One; tomorrow: Metals API / custom)
              │
              ▼
 ┌────────────────────────────┐
 │  Supabase Edge Function    │
 │  pull-live-rates           │
 │  (provider-abstracted)     │
 └──────────┬─────────────────┘
            │ writes mcx_ltp / high / low / updated_at
            ▼
 ┌────────────────────────────┐         ┌──────────────────────────┐
 │   public.rates             │         │  public.rates_health     │
 │   (existing — unchanged)   │         │  (new monitoring row)    │
 └──────────┬─────────────────┘         └──────────────────────────┘
            │ realtime + 4s polling
   ┌────────┴────────┐
   ▼                 ▼
 Web app           Android APK
                     ▲
                     │ scheduled every minute, 24/7
 ┌──────────────────────────────┐
 │ pg_cron + pg_net (Supabase)  │
 └──────────────────────────────┘
```

No browser, no laptop, no Replit. The writer lives entirely inside Supabase.

## 3. What was added in this project

| File | Purpose |
|---|---|
| `supabase/functions/pull-live-rates/index.ts` | Edge Function entry. Reads provider config, loops twice per invocation (30s cadence), writes base rows, updates health. |
| `supabase/functions/pull-live-rates/providers/types.ts` | `RateProvider` interface. The contract every provider must implement. |
| `supabase/functions/pull-live-rates/providers/registry.ts` | Factory: maps `app_settings.rate_provider` → provider implementation. Add new providers here. |
| `supabase/functions/pull-live-rates/providers/angel-one.ts` | Angel One SmartAPI implementation (login + TOTP + OHLC quote). JWT cached in `app_settings.angel_one_jwt`. |
| `supabase/functions/_shared/totp.ts` | RFC 6238 TOTP using Web Crypto. |
| `supabase/functions/discover-angel-tokens/index.ts` | One-shot helper to find current MCX `symbolToken` values after each contract rollover. |
| `docs/sql/phase10_rates_health_and_cron.sql` | Creates `rates_health`, seeds `app_settings` provider keys, schedules pg_cron every minute. |

The web app, APK, admin, order booking, VIP logic, WhatsApp/call settings,
buffers, and position limits are **completely untouched**. They already read
from `public.rates` — that contract is preserved.

## 4. Provider abstraction

`app_settings.rate_provider` (text) selects the implementation. The Edge
Function never references Angel One directly:

```ts
const provider = getProvider(cfg.providerId, supabase);
const { gold, silver } = await provider.fetchQuotes({ goldSymbol, silverSymbol, extra });
```

Switching providers later means:
1. Add a new file in `providers/` implementing `RateProvider`.
2. Add the `case` in `registry.ts`.
3. Update `app_settings.rate_provider` (and any provider symbols/secrets).

No APK rebuild. No web deploy. No client code change.

## 5. Required Supabase Secrets (Edge Function env)

Set in **Supabase Dashboard → Project Settings → Edge Functions → Secrets**
(on the RB project):

| Secret | Purpose | Required |
|---|---|---|
| `SUPABASE_URL` | auto-provided by Supabase | ✅ auto |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-provided by Supabase | ✅ auto |
| `ANGEL_ONE_API_KEY` | SmartAPI app key | ✅ |
| `ANGEL_ONE_CLIENT_CODE` | Angel client id (e.g. `R123456`) | ✅ |
| `ANGEL_ONE_MPIN` | 4-digit MPIN | ✅ |
| `ANGEL_ONE_TOTP_SECRET` | base32 TOTP seed shown when 2FA was enabled | ✅ |
| `PULL_RATES_CRON_SECRET` | any random string; rejects non-cron callers | recommended |

## 6. Required `app_settings` rows (seeded by migration, fill values after)

| id | example | notes |
|---|---|---|
| `rate_provider` | `ANGEL_ONE` | only `ANGEL_ONE` shipped today |
| `provider_exchange` | `MCX` | passed through to provider |
| `provider_symbol_gold` | `253461` | numeric symbolToken — discover via helper |
| `provider_symbol_silver` | `261307` | numeric symbolToken — discover via helper |
| `pull_interval_seconds` | `30` | sub-loop interval |
| `pull_loops_per_invocation` | `2` | 2 × 30s = 60s, matches pg_cron 1-min cadence |

## 7. Deployment checklist

1. **Install Supabase CLI** (`brew install supabase/tap/supabase` or `npm i -g supabase`) and run `supabase login`.
2. **Link** project: `supabase link --project-ref <RB_PROJECT_REF>`.
3. **Add secrets** (dashboard or CLI):
   ```bash
   supabase secrets set \
     ANGEL_ONE_API_KEY=... \
     ANGEL_ONE_CLIENT_CODE=... \
     ANGEL_ONE_MPIN=... \
     ANGEL_ONE_TOTP_SECRET=... \
     PULL_RATES_CRON_SECRET=$(openssl rand -hex 24)
   ```
4. **Deploy functions**:
   ```bash
   supabase functions deploy pull-live-rates
   supabase functions deploy discover-angel-tokens
   ```
5. **Discover MCX tokens** (one-time per contract):
   ```bash
   curl -X POST https://<RB_PROJECT_REF>.functions.supabase.co/discover-angel-tokens \
     -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"search":"GOLD"}'
   # repeat with {"search":"SILVER"} — pick the active near-month future
   ```
6. **Run the migration** (`docs/sql/phase10_rates_health_and_cron.sql`):
   - Edit the `cron.schedule(...)` block — replace `<PROJECT_REF>` and `<CRON_SECRET>` with real values.
   - Enable `pg_cron` + `pg_net` in **Database → Extensions** if not already on.
   - Run the SQL in **SQL Editor**.
7. **Set the discovered symbols**:
   ```sql
   update app_settings set value_text = '253461' where id = 'provider_symbol_gold';
   update app_settings set value_text = '261307' where id = 'provider_symbol_silver';
   ```
8. **Smoke test** (manual invoke):
   ```bash
   curl -X POST https://<RB_PROJECT_REF>.functions.supabase.co/pull-live-rates \
     -H "x-cron-secret: <CRON_SECRET>"
   ```
   Then check:
   ```sql
   select id, mcx_ltp, high, low, updated_at from rates where id in ('gold','silver');
   select * from rates_health where id = 'pull-live-rates';
   ```
9. **Decommission Replit**: stop the script. Wait 5 minutes. Confirm `rates.updated_at` keeps advancing in Supabase and the APK still shows live ticks.

## 8. Failure handling

- **Invalid quote** (null / non-positive `ltp`) → write is rejected; previous row stays. `rates_health.status` flips to `warning` / `degraded`, `last_error` set.
- **Auth expired** → Edge Function transparently re-logs-in via TOTP and retries the same iteration.
- **3+ consecutive failures** → `status = 'degraded'`, surfaced via `rates_health` so an admin dashboard widget or external monitor can alert.
- **pg_cron failure** → visible in `cron.job_run_details`.
- **Stale-rate detection in the app** → optionally compare `rates.updated_at` against `now()`; older than ~2 minutes during market hours = problem.

## 9. Success criteria — verified by

| Requirement | How to verify |
|---|---|
| Rates update with all laptops OFF | Close every tab, wait 5 min, query `rates.updated_at`. |
| Rates update with Lovable preview closed | Same. |
| Rates update with Replit deleted | Delete Replit project, observe `rates_health.last_successful_fetch` keeps advancing. |
| Provider swap requires only backend changes | Add new file in `providers/`, add case in `registry.ts`, update `app_settings.rate_provider`. Zero client edits. |
| APK rebuild not required for provider swap | APK reads `public.rates` only — schema unchanged. |