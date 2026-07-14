import Taro from "@tarojs/taro";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tarojs/components", () => ({ Text: "text", View: "view" }));
vi.mock("@nutui/nutui-react-taro", () => ({ Button: "button" }));
vi.mock("@tarojs/taro", () => ({
  default: {
    getStorageSync: vi.fn(),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    login: vi.fn(),
    request: vi.fn(),
    redirectTo: vi.fn(),
    showToast: vi.fn(),
  },
}));

import { productionLogin } from "./index";

const taro = vi.mocked(Taro);

describe("production login boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KITH_INN_DEV_BUILD = "0";
    process.env.BE_BASE_URL = "https://codeforpeople.cn";
  });

  it("never falls back to dev-login when production weapp wx-login fails", async () => {
    taro.login.mockResolvedValue({ code: "wx-code" } as Awaited<ReturnType<typeof Taro.login>>);
    taro.request.mockResolvedValue({ statusCode: 503 } as Awaited<ReturnType<typeof Taro.request>>);

    await productionLogin("weapp");

    expect(taro.request).toHaveBeenCalledTimes(1);
    expect(taro.request).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/\/auth\/wx-login$/) }));
    expect(taro.request).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/\/auth\/dev-login$/) }));
    expect(taro.showToast).toHaveBeenCalledWith({ title: "登录失败", icon: "error" });
  });

  it("fails explicitly on production H5 without calling or showing dev-login", async () => {
    await productionLogin("h5");

    expect(taro.login).not.toHaveBeenCalled();
    expect(taro.request).not.toHaveBeenCalled();
    expect(taro.showToast).toHaveBeenCalledWith({ title: "请使用微信小程序登录", icon: "none" });
  });

  it("persists the token after a successful production weapp login", async () => {
    taro.login.mockResolvedValue({ code: "wx-code" } as Awaited<ReturnType<typeof Taro.login>>);
    taro.request.mockResolvedValue({ statusCode: 200, data: { token: "wx-token" } } as Awaited<
      ReturnType<typeof Taro.request>
    >);

    await productionLogin("weapp");

    expect(taro.request).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/\/auth\/wx-login$/) }));
    expect(taro.setStorageSync).toHaveBeenCalledWith("kith_inn_token", "wx-token");
    expect(taro.redirectTo).toHaveBeenCalledWith({ url: "/pages/today/index" });
  });
});
