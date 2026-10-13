import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { AppError } from "../domain/contracts";
import { rateLimit } from "../server/http";

export function limitRecoveryCaller(request: Request) {
  let caller = "local-development";
  if (process.env.HELLO_TRUST_PROXY === "true") {
    // Only enable behind the repository proxy: it overwrites X-Real-IP and
    // the application port is bound to loopback. Never trust X-Forwarded-For.
    const address = request.headers.get("x-real-ip") || "";
    if (!isIP(address)) throw new AppError(503, "恢复入口的来源校验暂不可用，请稍后重试");
    caller = createHash("sha256").update(address).digest("hex");
  } else if (process.env.HELLO_DEPLOYED === "true") {
    throw new AppError(503, "恢复入口的代理保护尚未配置，请稍后重试");
  }
  // Malformed and failed attempts count only against this caller. Repeated
  // caller-limit rejections never charge the separate global DB backstop.
  rateLimit(`privacy-recover:caller:${caller}`, 20);
}
export function limitRecoveryLookup() {
  rateLimit("privacy-recover:global", 200);
}
