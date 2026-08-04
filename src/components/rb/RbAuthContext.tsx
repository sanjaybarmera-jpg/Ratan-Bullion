import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  clearRbSession,
  getSavedMobile,
  getSavedName,
  setSavedMobile,
  setSavedName,
} from "@/lib/rb-device";
import { verifyAccess, type AccessResponse, type AccessState } from "@/lib/rb-auth";

type RbAuthState = {
  loading: boolean;
  mobile: string | null;
  name: string | null;
  access: AccessState | null;
  customerId?: string;
  isVip: boolean;
  refresh: () => Promise<void>;
  setMobileAndRefresh: (mobile: string) => Promise<AccessResponse>;
  setName: (name: string) => void;
  signOut: () => void;
};

const Ctx = createContext<RbAuthState | null>(null);

export function RbAuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [mobile, setMobile] = useState<string | null>(null);
  const [name, setNameState] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessState | null>(null);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [isVip, setIsVip] = useState<boolean>(false);

  async function loadFor(m: string | null) {
    if (!m) {
      setAccess(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await verifyAccess(m);
    setAccess(res.access);
    setCustomerId(res.customer_id);
    setIsVip(!!res.is_vip);
    if (res.access === "granted" && res.name) {
      setNameState(res.name);
      setSavedName(res.name);
    }
    setLoading(false);
  }

  useEffect(() => {
    const m = getSavedMobile();
    const n = getSavedName();
    setMobile(m);
    setNameState(n);
    loadFor(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: RbAuthState = {
    loading,
    mobile,
    name,
    access,
    customerId,
    refresh: () => loadFor(mobile),
    async setMobileAndRefresh(m: string) {
      setSavedMobile(m);
      setMobile(m);
      const res = await verifyAccess(m);
      setAccess(res.access);
      setCustomerId(res.customer_id);
      setIsVip(!!res.is_vip);
      if (res.access === "granted" && res.name) {
        setNameState(res.name);
        setSavedName(res.name);
      }
      setLoading(false);
      return res;
    },
    setName(n: string) {
      setNameState(n);
      setSavedName(n);
    },
    signOut() {
      clearRbSession();
      setMobile(null);
      setNameState(null);
      setAccess(null);
      setCustomerId(undefined);
      setIsVip(false);
    },
    isVip,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRbAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRbAuth must be used inside RbAuthProvider");
  return v;
}