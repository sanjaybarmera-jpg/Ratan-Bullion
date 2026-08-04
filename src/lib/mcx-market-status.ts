// MCX market session status (IST).
// Official MCX non-agri trading: Mon–Fri, 09:00–23:30 IST.
// Closed on Saturday and Sunday. This ignores exchange holidays.
//
// Single source of truth — do not duplicate this logic elsewhere.

export type McxStatus = {
  isOpen: boolean;
  label: string; // "LIVE MARKET" | "MARKET CLOSED"
};

// Returns {year, month, day, weekday, hour, minute} in IST for a given Date.
function istParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday"); // Mon, Tue, ...
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  return { weekday, hour, minute };
}

export function getMcxMarketStatus(now: Date = new Date()): McxStatus {
  const { weekday, hour, minute } = istParts(now);
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  const minutes = hour * 60 + minute;
  const OPEN = 9 * 60;         // 09:00 IST
  const CLOSE = 23 * 60 + 30;  // 23:30 IST
  const isOpen = !isWeekend && minutes >= OPEN && minutes < CLOSE;
  return {
    isOpen,
    label: isOpen ? "LIVE MARKET" : "MARKET CLOSED",
  };
}