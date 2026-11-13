import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const callbacks = vi.hoisted(() => ({
  close: (_result: { isEnded: boolean }) => {},
  error: () => {},
}));
const ad = vi.hoisted(() => ({
  load: vi.fn(),
  show: vi.fn(),
  destroy: vi.fn(),
  offClose: vi.fn(),
  offError: vi.fn(),
  onClose: vi.fn(),
  onError: vi.fn(),
}));
vi.mock("@tarojs/taro", () => ({
  default: { createRewardedVideoAd: () => ad },
}));
import { completedVideo, watchWechatAd } from "../src/chat/rewarded-ad";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TARO_ENV", "weapp");
  ad.load.mockResolvedValue(undefined);
  ad.show.mockResolvedValue(undefined);
  ad.onClose.mockImplementation((callback) => {
    callbacks.close = callback;
  });
  ad.onError.mockImplementation((callback) => {
    callbacks.error = callback;
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("激励广告完整观看判定", () => {
  it("仅明确的完整播放可以触发奖励", () => {
    expect(completedVideo({ isEnded: true })).toBe(true);
    expect(completedVideo({ isEnded: false })).toBe(false);
    expect(completedVideo({})).toBe(false);
    expect(completedVideo(undefined)).toBe(false);
  });
  it("完整结束后清理监听器，提前关闭不会成功", async () => {
    const complete = watchWechatAd("test-ad");
    await Promise.resolve();
    callbacks.close({ isEnded: true });
    await complete;
    expect(ad.destroy).toHaveBeenCalledTimes(1);
    expect(ad.offClose).toHaveBeenCalledTimes(1);
    const early = watchWechatAd("test-ad");
    const assertion = expect(early).rejects.toThrow(/未看完/);
    callbacks.close({ isEnded: false });
    await assertion;
  });
  it("加载失败不显示广告、不发放奖励，H5 明确不支持微信广告", async () => {
    ad.load.mockRejectedValueOnce(new Error("network"));
    await expect(watchWechatAd("test-ad")).rejects.toThrow(/加载不了/);
    expect(ad.show).not.toHaveBeenCalled();
    vi.stubEnv("TARO_ENV", "h5");
    await expect(watchWechatAd("test-ad")).rejects.toThrow(/仅能/);
  });
});
