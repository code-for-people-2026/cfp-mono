import { createHmac, randomUUID } from "node:crypto";
import type { AgeEvidence, AgeVerifier } from "./provider";
import { ageProvider, providerConfigured } from "./policy";

// A birthday is used only after the provider confirms the supplied name/ID pair.
// This validates syntax/checksum, not identity. It must never grant access alone.
export function idAgeBand(idCard: string, now = new Date()): "under14" | "14to17" | "adult" | undefined {
  if (!/^[1-9]\d{16}[\dX]$/.test(idCard)) return;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  if ("10X98765432"[weights.reduce((sum, weight, index) => sum + Number(idCard[index]) * weight, 0) % 11] !== idCard[17]) return;
  const birthday = `${idCard.slice(6, 10)}-${idCard.slice(10, 12)}-${idCard.slice(12, 14)}`;
  const date = new Date(`${birthday}T00:00:00Z`);
  const today = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== birthday || birthday < "1900-01-01" || birthday > today) return;
  const years = Number(today.slice(0, 4)) - Number(birthday.slice(0, 4)) - (today.slice(5) < birthday.slice(5) ? 1 : 0);
  return years < 14 ? "under14" : years < 18 ? "14to17" : "adult";
}
export function interpretAliyun(value: unknown, idCard: string, now = new Date()): AgeEvidence {
  if (!value || typeof value !== "object") return { state: "unavailable" };
  const result = value as { Code?: unknown; RequestId?: unknown; ResultObject?: { BizCode?: unknown } };
  const reference = typeof result.RequestId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(result.RequestId) ? result.RequestId : undefined;
  if (result.Code !== "200" || !reference) return { state: "unavailable" };
  if (result.ResultObject?.BizCode === "2") return { state: "failed", reference };
  if (result.ResultObject?.BizCode !== "1") return { state: "unknown", reference };
  const ageBand = idAgeBand(idCard, now);
  return ageBand ? { state: ageBand === "adult" ? "adult" : "minor", ageBand, reference } : { state: "unknown", reference };
}
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
export function aliyunRequest(input: { name: string; idCard: string }, key: string, secret: string, now = new Date(), nonce: string = randomUUID(), token?: string) {
  const parameters: Record<string, string> = {
    AccessKeyId: key, Action: "Id2MetaVerify", Version: "2019-03-07", Format: "JSON",
    SignatureMethod: "HMAC-SHA1", SignatureVersion: "1.0", SignatureNonce: nonce,
    Timestamp: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    ParamType: "normal", UserName: input.name, IdentifyNum: input.idCard,
    ...(token ? { SecurityToken: token } : {}),
  };
  const canonical = Object.keys(parameters).sort().map((key) => `${encode(key)}=${encode(parameters[key])}`).join("&");
  const signature = createHmac("sha1", `${secret}&`).update(`POST&%2F&${encode(canonical)}`).digest("base64");
  // All parameters stay in the HTTPS body, never the URL or application logs.
  return { body: `${canonical}&Signature=${encode(signature)}`, headers: { "Content-Type": "application/x-www-form-urlencoded" } };
}
export const verifyAliyunAge: AgeVerifier = async (input) => {
  if (ageProvider() !== "aliyun" || !providerConfigured()) return { state: "unavailable" };
  const band = idAgeBand(input.idCard);
  if (!band) return { state: "failed" };
  if (band === "under14") return { state: "needs_review" };
  try {
    const signed = aliyunRequest(input, process.env.HELLO_AGE_SECRET_ID!, process.env.HELLO_AGE_SECRET_KEY!, new Date(), randomUUID(), process.env.HELLO_AGE_SESSION_TOKEN);
    const response = await fetch("https://cloudauth.cn-shanghai.aliyuncs.com/", { method: "POST", ...signed, signal: AbortSignal.timeout(12_000), redirect: "error" });
    if (!response.ok) return { state: "unavailable" };
    return interpretAliyun(await response.json(), input.idCard);
  } catch { return { state: "unavailable" }; }
};
