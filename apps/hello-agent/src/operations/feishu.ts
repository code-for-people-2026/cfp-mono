import { createHash, createHmac } from "node:crypto";
import { z } from "zod";

export type FeishuConfig = { webhook: string; secret: string; origin: string; fingerprint: string; enabled: boolean };
// A webhook is a credential. Never include it, provider bodies or network errors in logs.
export function feishuConfig(env: Record<string, string | undefined> = process.env): FeishuConfig | null {
  try {
    const webhook = new URL(env.HELLO_FEISHU_WEBHOOK || "");
    const origin = new URL(env.HELLO_ORIGIN || "");
    const secret = env.HELLO_FEISHU_SIGNING_SECRET || "";
    if (webhook.origin !== "https://open.feishu.cn" || webhook.username || webhook.password || webhook.search || webhook.hash
      || !/^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]+$/.test(webhook.pathname) || secret.length < 16
      || origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") return null;
    const fingerprint = createHash("sha256").update(`${webhook.href}\n${secret}\n${origin.origin}`).digest("hex");
    return { webhook: webhook.href, secret, origin: origin.origin, fingerprint, enabled: env.HELLO_FEISHU_ALERTS_ENABLED === "true" };
  } catch { return null; }
}
export type FeishuResult = { ok: true } | { ok: false; code: string; retryable: boolean };
export function feishuMessage(config: FeishuConfig, target: { caseId: number; receipt: string } | { testId: string }, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  const sign = createHmac("sha256", `${timestamp}\n${config.secret}`).update("").digest("base64");
  const summary = "caseId" in target
    ? `【阿 J 安全值守】紧急事项待人工处理\n案件编号：${z.string().uuid().parse(target.receipt)}\n请立即登录后台查看并领取。\n${config.origin}/admin/collections/safety-cases/${z.number().int().positive().parse(target.caseId)}`
    : `【阿 J 安全值守】通知连通测试，无真实危机事件。\n核验编号：${z.string().uuid().parse(target.testId)}\n请确认手机能收到这条提醒。\n${config.origin}/admin`;
  return { timestamp, sign, msg_type: "text", content: { text: `${summary}\n<at user_id="all">所有人</at>` } };
}
export async function sendFeishu(config: FeishuConfig, target: { caseId: number; receipt: string } | { testId: string }, request: typeof fetch = fetch): Promise<FeishuResult> {
  try {
    const response = await request(config.webhook, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(feishuMessage(config, target)) });
    if (!response.ok) return { ok: false, code: `http_${response.status}`, retryable: response.status === 429 };
    const body: unknown = await response.json();
    const parsed = z.object({ code: z.number().optional(), StatusCode: z.number().optional() }).safeParse(body);
    if (!parsed.success) return { ok: false, code: "invalid_response", retryable: false };
    const codes = [parsed.data.code, parsed.data.StatusCode].filter((x): x is number => x !== undefined);
    if (codes.length && codes.every((code) => code === 0)) return { ok: true };
    const code = codes.find((value) => value !== 0);
    return { ok: false, code: code === undefined ? "invalid_response" : `provider_${code}`, retryable: code === 11232 || code === 99991400 };
  // A timeout or unreadable acknowledgement may follow a successful delivery.
  // Retry only explicit rate-limit refusals, never an uncertain side effect.
  } catch { return { ok: false, code: "network_or_timeout", retryable: false }; }
}
