/**
 * Today's date (YYYY-MM-DD) in Asia/Shanghai (桃子's tz), off an injectable clock
 * (default = real now) so it's deterministic in tests. Mirrors be's agent/services.ts
 * todayShanghai — ponytail: FE-local until the protocol layer (#89) shares it.
 */
export function todayShanghai(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
