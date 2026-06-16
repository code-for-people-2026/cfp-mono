type RateLimitConfig = {
  perMinute: number;
  perHour: number;
};

type Bucket = {
  minute: number[];
  hour: number[];
};

export function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function createRateLimiter(config: RateLimitConfig) {
  const buckets = new Map<string, Bucket>();

  return {
    check(ip: string, now = Date.now()) {
      const bucket = buckets.get(ip) ?? { minute: [], hour: [] };
      bucket.minute = bucket.minute.filter((timestamp) => now - timestamp < 60_000);
      bucket.hour = bucket.hour.filter((timestamp) => now - timestamp < 3_600_000);

      if (bucket.minute.length >= config.perMinute || bucket.hour.length >= config.perHour) {
        buckets.set(ip, bucket);
        return { allowed: false, retryAfterSeconds: 60 };
      }

      bucket.minute.push(now);
      bucket.hour.push(now);
      buckets.set(ip, bucket);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

export const chatRateLimiter = createRateLimiter({
  perMinute: parsePositiveInteger(process.env.CHAT_RATE_LIMIT_PER_MINUTE, 10),
  perHour: parsePositiveInteger(process.env.CHAT_RATE_LIMIT_PER_HOUR, 100),
});

export const summarizeRateLimiter = createRateLimiter({
  perMinute: parsePositiveInteger(process.env.SUMMARY_RATE_LIMIT_PER_MINUTE, 20),
  perHour: parsePositiveInteger(process.env.SUMMARY_RATE_LIMIT_PER_HOUR, 200),
});
