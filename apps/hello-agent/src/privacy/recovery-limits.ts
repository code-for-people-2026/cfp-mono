import { trustedPrivacyCaller } from "../server/request-source";
import { rateLimit } from "../server/http";

export function limitRecoveryCaller(request: Request) {
  const caller = trustedPrivacyCaller(request);
  // Malformed and failed attempts count only against this caller. Repeated
  // caller-limit rejections never charge the separate global DB backstop.
  rateLimit(`privacy-recover:caller:${caller}`, 20);
}
export function limitRecoveryLookup() {
  rateLimit("privacy-recover:global", 200);
}
