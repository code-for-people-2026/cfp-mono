import { rateLimitGroup } from "./http";
import { trustedPrivacyCaller } from "./request-source";

export function rateLimitLogin(request: Request, endpoint: string) {
  const caller = trustedPrivacyCaller(request);
  rateLimitGroup([
    { key: `${endpoint}:caller:${caller}`, maximum: 20 },
    { key: `${endpoint}:global`, maximum: 1000 },
  ]);
}
