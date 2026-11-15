import type { Payload } from "payload";
import { AppError } from "../domain/contracts";
import { reserveDailyQuota } from "../cms/daily-quota";
import { rateLimitGroup } from "./http";
import { trustedPrivacyCaller } from "./request-source";

type Entry = "identity" | "safety";
const defaults = { identity: { caller: 100, global: 10_000 }, safety: { caller: 20, global: 1_000 } };
function dailyLimit(entry: Entry, scope: "caller" | "global") {
  const configured = process.env[`HELLO_${entry.toUpperCase()}_${scope.toUpperCase()}_DAILY_LIMIT`] ?? String(defaults[entry][scope]);
  const value = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(value)) throw new AppError(503, "入口受理额度配置无效，请联系管理员");
  return value;
}

// Anonymous owners can be minted again, so neither a cookie nor its owner ID is
// an abuse boundary. Use the proxy-confirmed caller plus a shared DB backstop.
export async function reservePublicAdmission(payload: Payload, request: Request, entry: Entry) {
  const caller = trustedPrivacyCaller(request);
  rateLimitGroup([
    { key: `public-admission:${entry}:caller:${caller}`, maximum: 20 },
    { key: `public-admission:${entry}:global`, maximum: 1_000 },
  ]);
  const callerLimit = dailyLimit(entry, "caller"), globalLimit = dailyLimit(entry, "global");
  await reserveDailyQuota(payload, {
    namespace: "admission",
    counters: [{ key: `${entry}:caller:${caller}`, limit: callerLimit }, { key: `${entry}:global`, limit: globalLimit }],
    exhaustedMessage: "当前来源或全站今日受理次数已达上限，请稍后再试",
    unavailableMessage: "暂时无法确认入口受理额度，请稍后重试",
  });
}
