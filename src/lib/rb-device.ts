const DEVICE_KEY = "rb.device_id";
const MOBILE_KEY = "rb.mobile";
const NAME_KEY = "rb.customer_name";

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "dev-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function normalizeMobile(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  // Strip leading country code 91 if 12 digits
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits.slice(-10);
}

export function getSavedMobile(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(MOBILE_KEY);
}

export function setSavedMobile(mobile: string) {
  localStorage.setItem(MOBILE_KEY, mobile);
}

export function getSavedName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(NAME_KEY);
}

export function setSavedName(name: string) {
  if (name) localStorage.setItem(NAME_KEY, name);
}

export function clearRbSession() {
  localStorage.removeItem(MOBILE_KEY);
  localStorage.removeItem(NAME_KEY);
}