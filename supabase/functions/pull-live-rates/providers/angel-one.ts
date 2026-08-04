// Angel One SmartAPI provider.
// Docs: https://smartapi.angelbroking.com/docs/Authentication
//       https://smartapi.angelbroking.com/docs/MarketData
//
// Auth: loginByPassword (clientcode + MPIN + TOTP) -> jwtToken, refreshToken.
// Quote: POST /rest/secure/angelbroking/market/v1/quote/ mode=OHLC
//
// jwtToken is cached in app_settings (id='angel_one_jwt') and reused until
// the provider returns 401/Invalid Token, then we re-login.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { totp } from "../../_shared/totp.ts";
import type { ProviderConfig, RateProvider, RawQuote } from "./types.ts";
import { clearMemoryCache, resolveActiveFut } from "./angel-scrip-master.ts";

const BASE = "https://apiconnect.angelone.in";
const LOGIN_URL = `${BASE}/rest/auth/angelbroking/user/v1/loginByPassword`;
const QUOTE_URL = `${BASE}/rest/secure/angelbroking/market/v1/quote/`;

function authHeaders(apiKey: string, jwt?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
    "X-PrivateKey": apiKey,
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
  };
}

async function login(apiKey: string, clientCode: string, mpin: string, totpSecret: string) {
  const otp = await totp(totpSecret);
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ clientcode: clientCode, password: mpin, totp: otp }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status === false || !json?.data?.jwtToken) {
    throw new Error(`Angel login failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data.jwtToken as string;
}

async function getCachedJwt(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("app_settings").select("value_text").eq("id", "angel_one_jwt").maybeSingle();
  return (data?.value_text as string | null) ?? null;
}

async function setCachedJwt(supabase: SupabaseClient, jwt: string) {
  await supabase.from("app_settings").upsert({ id: "angel_one_jwt", value_text: jwt });
}

async function fetchOhlc(apiKey: string, jwt: string, exchangeTokens: Record<string, string[]>) {
  const res = await fetch(QUOTE_URL, {
    method: "POST",
    headers: authHeaders(apiKey, jwt),
    body: JSON.stringify({ mode: "OHLC", exchangeTokens }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 || json?.errorcode === "AB1010" || json?.message === "Invalid Token") {
    const err = new Error("ANGEL_AUTH_EXPIRED");
    (err as any).code = "ANGEL_AUTH_EXPIRED";
    throw err;
  }
  if (!res.ok || json?.status === false) {
    throw new Error(`Angel quote failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data?.fetched as Array<{
    exchange: string;
    tradingSymbol: string;
    symbolToken: string;
    ltp: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
}

function pick(fetched: Array<{ symbolToken: string; ltp: number; high: number; low: number; tradingSymbol: string }>, token: string, label: string): RawQuote {
  const row = fetched.find((q) => q.symbolToken === token);
  if (!row) throw new Error(`Angel quote missing symbol ${label} (token=${token})`);
  if (!Number.isFinite(row.ltp) || row.ltp <= 0) throw new Error(`Angel returned invalid ltp for ${label}`);
  return {
    symbol: row.tradingSymbol,
    ltp: Number(row.ltp),
    high: Number(row.high) || Number(row.ltp),
    low: Number(row.low) || Number(row.ltp),
  };
}

export function createAngelOneProvider(supabase: SupabaseClient): RateProvider {
  return {
    name: "ANGEL_ONE",
    async fetchQuotes(cfg: ProviderConfig) {
      const apiKey = Deno.env.get("ANGEL_ONE_API_KEY");
      const clientCode = Deno.env.get("ANGEL_ONE_CLIENT_CODE");
      const mpin = Deno.env.get("ANGEL_ONE_MPIN");
      const totpSecret = Deno.env.get("ANGEL_ONE_TOTP_SECRET");
      if (!apiKey || !clientCode || !mpin || !totpSecret) {
        throw new Error("Angel One secrets missing: ANGEL_ONE_API_KEY / CLIENT_CODE / MPIN / TOTP_SECRET");
      }
      // Auto-discover the active near-month MCX FUTCOM contracts. No app_settings
      // rows required; cached 24h with automatic rollover after expiry.
      const exchange = cfg.extra.exchange || "MCX";
      const [goldC, silverC] = await Promise.all([
        resolveActiveFut(supabase, "GOLD"),
        resolveActiveFut(supabase, "SILVER"),
      ]);
      let goldToken = goldC.symbolToken;
      let silverToken = silverC.symbolToken;
      let exchangeTokens: Record<string, string[]> = {
        [exchange]: [goldToken, silverToken],
      };

      let jwt = await getCachedJwt(supabase);
      const fetchWith = async (token: string) => fetchOhlc(apiKey, token, exchangeTokens);

      let fetched: Awaited<ReturnType<typeof fetchOhlc>> | null = null;
      if (jwt) {
        try {
          fetched = await fetchWith(jwt);
        } catch (e) {
          if ((e as any).code !== "ANGEL_AUTH_EXPIRED") throw e;
          jwt = null;
        }
      }
      if (!fetched) {
        jwt = await login(apiKey, clientCode, mpin, totpSecret);
        await setCachedJwt(supabase, jwt);
        fetched = await fetchWith(jwt);
      }

      // If a cached contract has silently rolled (broker no longer returns it),
      // force a re-resolve and retry once.
      const haveGold = fetched.some((q) => q.symbolToken === goldToken);
      const haveSilver = fetched.some((q) => q.symbolToken === silverToken);
      if (!haveGold || !haveSilver) {
        clearMemoryCache();
        const [g2, s2] = await Promise.all([
          resolveActiveFut(supabase, "GOLD", { force: true }),
          resolveActiveFut(supabase, "SILVER", { force: true }),
        ]);
        goldToken = g2.symbolToken;
        silverToken = s2.symbolToken;
        exchangeTokens = { [exchange]: [goldToken, silverToken] };
        fetched = await fetchOhlc(apiKey, jwt!, exchangeTokens);
      }

      return {
        gold: pick(fetched, goldToken, "gold"),
        silver: pick(fetched, silverToken, "silver"),
      };
    },
  };
}