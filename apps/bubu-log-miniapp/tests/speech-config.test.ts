import { afterEach, expect, it, vi } from "vitest";
import { getWechatSpeechPlugin } from "../config/speech";
afterEach(() => { vi.unstubAllEnvs(); });
it("does not borrow another miniapp's plugin authorization", () => {
  vi.stubEnv("BUBU_WECHAT_SI_VERSION", ""); expect(getWechatSpeechPlugin()).toBeUndefined();
  vi.stubEnv("BUBU_WECHAT_SI_VERSION", "0.3.10"); expect(getWechatSpeechPlugin()).toEqual({ version: "0.3.10", provider: "wx069ba97219f66d99" });
});
