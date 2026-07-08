/**
 * Today's date (YYYY-MM-DD) in Asia/Shanghai (桃子's tz). Kept FE-local because
 * Taro/webpack doesn't transpile shared package .ts runtime exports.
 */
export function todayShanghai(now: Date = new Date()): string {
  // ponytail: China has no DST; adding UTC+8 avoids Intl, which is absent on some WeChat real-device runtimes.
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
