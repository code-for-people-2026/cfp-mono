import { createHash, createHmac } from "node:crypto";
import { providerConfigured } from "./policy";

export type AgeEvidence = {
  state: "adult" | "minor" | "unknown" | "failed" | "unavailable" | "needs_review";
  reference?: string;
};
export type AgeVerifier = (input: { name: string; idCard: string }) => Promise<AgeEvidence>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();

// Result belongs specifically to MinorsVerification, not IdCardVerification.
export function interpretTencent(value: unknown): AgeEvidence {
  if (!value || typeof value !== "object") return { state: "unavailable" };
  const response = (value as { Response?: Record<string, unknown> }).Response;
  if (!response || response.Error) return { state: "unavailable" };
  const reference = typeof response.RequestId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(response.RequestId) ? response.RequestId : undefined;
  if (!reference) return { state: "unavailable" };
  if (response.Result === "0") return { state: response.AgeRange === "[18,+)" ? "adult" : "needs_review", reference };
  if (response.Result === "-1") return { state: ["[0,8)", "[8,16)", "[16,18)"].includes(String(response.AgeRange)) ? "minor" : "needs_review", reference };
  if (["-2", "-7"].includes(String(response.Result))) return { state: "unknown", reference };
  if (["-3", "-4", "-5"].includes(String(response.Result))) return { state: "failed", reference };
  return { state: "unavailable", reference };
}
export function tencentRequest(input: { name: string; idCard: string }, secretId: string, secretKey: string, now: number) {
  const host = "faceid.tencentcloudapi.com";
  const timestamp = Math.floor(now / 1000);
  const date = new Date(now).toISOString().slice(0, 10);
  const body = JSON.stringify({ Type: "1", Name: input.name, IdCard: input.idCard });
  const signedHeaders = "content-type;host";
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\n${signedHeaders}\n${hash(body)}`;
  const scope = `${date}/faceid/tc3_request`;
  const toSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`;
  const signature = createHmac("sha256", hmac(hmac(hmac(`TC3${secretKey}`, date), "faceid"), "tc3_request")).update(toSign).digest("hex");
  return { body, headers: {
    "Content-Type": "application/json; charset=utf-8", Host: host,
    "X-TC-Action": "MinorsVerification", "X-TC-Version": "2018-03-01", "X-TC-Timestamp": String(timestamp),
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    ...(process.env.HELLO_AGE_SESSION_TOKEN ? { "X-TC-Token": process.env.HELLO_AGE_SESSION_TOKEN } : {}),
  } };
}
export const verifyTencentAge: AgeVerifier = async (input) => {
  if (!providerConfigured()) return { state: "unavailable" };
  try {
    const signed = tencentRequest(input, process.env.HELLO_AGE_SECRET_ID!, process.env.HELLO_AGE_SECRET_KEY!, Date.now());
    const response = await fetch("https://faceid.tencentcloudapi.com/", { method: "POST", ...signed, signal: AbortSignal.timeout(12_000), redirect: "error" });
    if (!response.ok) return { state: "unavailable" };
    return interpretTencent(await response.json());
  } catch {
    // Never propagate vendor errors: they may echo ID data or authorization.
    return { state: "unavailable" };
  }
};
