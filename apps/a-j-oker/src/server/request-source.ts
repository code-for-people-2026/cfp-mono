import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { AppError } from "../domain/contracts";

export function trustedPrivacyCaller(request: Request) {
  if (process.env.HELLO_TRUST_PROXY === "true") {
    // The repository proxy overwrites X-Real-IP; the app port is loopback-only.
    // Do not use the client-appendable X-Forwarded-For chain.
    const address = request.headers.get("x-real-ip") || "";
    if (!isIP(address)) throw new AppError(503, "隐私入口的来源校验暂不可用，请稍后重试");
    return createHash("sha256").update(address).digest("hex");
  }
  if (process.env.HELLO_DEPLOYED === "true") throw new AppError(503, "隐私入口的代理保护尚未配置，请稍后重试");
  return "local-development";
}
