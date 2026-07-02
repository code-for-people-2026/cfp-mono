/**
 * Today's date (YYYY-MM-DD) in Asia/Shanghai (桃子's tz). Mirrors
 * @cfp/kith-inn-shared/util todayShanghai — kept FE-local because Taro/webpack
 * doesn't transpile the shared package's .ts source (no dist), so value-importing
 * it breaks the weapp build (#89 PR B deferred the FE-side util collapse until
 * shared ships a compiled dist or taro is configured to transpile it).
 */
export function todayShanghai(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
