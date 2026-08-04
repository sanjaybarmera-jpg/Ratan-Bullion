## Root Cause

`adminLogin` has two code paths that produce **incompatible tokens**:

1. **RPC path** (`verify_admin_pin`): if the RPC succeeds, `adminLogin` returns the token *as issued by the RPC* (`pickToken(payload)`). The RPC writes its own row into `admin_sessions` and stores the token in `admin_key` in whatever format it uses (plaintext or a different hash).
2. **Fallback path** (`plainPinLogin`): generates a random token, stores `sha256(token)` in `admin_sessions.admin_key`, and returns the raw token.

`checkAdmin` only ever looks up rows by `sha256(token)`:

```ts
const tokenHash = await sha256Hex(token);
.eq("admin_key", tokenHash)
```

So when the RPC path wins (which it does in production — that's why deleting `admin_pin_hash:admin` didn't change behavior; the RPC validates against its own store), the browser holds a token whose SHA-256 does **not** match the `admin_key` the RPC inserted. Result:
- PIN login returns `ok: true` with a token → dashboard mounts.
- First authenticated server fn call (`adminListCustomers`, `adminListDevices`, etc.) runs `checkAdmin` → `invalid_token` → returns `{ unauthorized: true }` → the dashboard's query `onUnauthorized` handler calls `onLogout()` → redirect back to PIN screen (~1s after mount, matching the 5s refetch + immediate first fetch).

This also explains: session rows exist, are not expired, not revoked — they're just keyed differently than what `checkAdmin` searches for.

## Exact Failing Condition

`checkAdmin(token)` returns `{ ok: false, reason: "invalid_token" }` because:
```
sha256Hex(rpcIssuedToken) !== admin_sessions.admin_key (written by verify_admin_pin RPC)
```

## Fix (single source of truth for session tokens)

Make `adminLogin` always mint its own token + session row using the same `sha256` format that `checkAdmin` expects. Use the RPC **only to verify the PIN**, never to issue the session.

### Changes to `src/lib/rb-admin.functions.ts`

1. Refactor `adminLogin.handler`:
   - Call `verify_admin_pin` RPC purely as a PIN check. Treat any `ok !== false` response as "PIN valid" and **discard any token in its payload**.
   - If RPC is unavailable or rejects, fall back to verifying the PIN against `admin_security` (existing `plainPinLogin` PIN-verification logic).
   - On successful PIN verification (by either route), execute a single shared block that:
     - generates `token = randomToken()`
     - inserts `{ admin_key: sha256Hex(token), expires_at: now+24h }` into `admin_sessions`
     - returns `{ ok: true, token }`
   - Split `plainPinLogin` into two helpers: `verifyPlainPin(username, pin)` (returns boolean + handles legacy → PBKDF2 upgrade) and `issueAdminSession()` (does the insert + returns token). Both login paths call `issueAdminSession()`.

2. Add temporary diagnostic logging (server-side only, no PII) inside `checkAdmin` and `adminLogin` behind a constant `DEBUG_ADMIN_AUTH = true`:
   - In `adminLogin`: log which path verified the PIN (`rpc` | `plain`), and `tokenHashPrefix = tokenHash.slice(0,8)` of the freshly issued session.
   - In `checkAdmin`: log `tokenLen`, `tokenHashPrefix`, and the outcome (`found` | `invalid_token` | `revoked` | `expired` | db error).
   - These logs only print hash prefixes, never the raw token or PIN.

3. Leave `adminLogout`, the localStorage key (`rb_admin_token`), and the `admin.tsx` bootstrap flow unchanged — they are already consistent with the sha256 scheme once login produces a matching token.

### Not changed (explicitly out of scope)

- Order logic, booking logic, rate fetching, customer flows.
- `verify_customer_access`, `placeOrder`, `getOpenPositions`, RLS policies.
- `admin_security` table or PBKDF2 PIN hashing.
- The `verify_admin_pin` SQL function itself.
- The audit route or any client-side admin gating.

## Verification Steps (after build mode)

1. Refresh `/admin`, enter PIN, confirm dashboard stays mounted for ≥60s and customer/device lists load.
2. Reload the page with a valid token in localStorage; confirm dashboard renders without bouncing to login.
3. Click Logout; confirm token cleared and PIN screen shown; confirm re-login still works.
4. Check server logs for the new `[admin-auth]` lines to confirm the issued token hash prefix matches the one used on subsequent `checkAdmin` calls.
5. After confirming the fix, remove or gate the diagnostic logs (will offer in the follow-up).

## Files To Change

- `src/lib/rb-admin.functions.ts` — refactor `adminLogin`, split `plainPinLogin`, add temporary logging in `adminLogin` + `checkAdmin`.

No other files require edits.