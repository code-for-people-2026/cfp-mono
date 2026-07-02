/**
 * Today's date (YYYY-MM-DD) in Asia/Shanghai (桃子's tz). Kept FE-local because
 * Taro/webpack doesn't transpile shared package .ts runtime exports.
 */
export function todayShanghai(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
