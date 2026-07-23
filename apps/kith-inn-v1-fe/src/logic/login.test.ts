import { describe, expect, it, vi } from "vitest";
import type { AuthResponse } from "@cfp/kith-inn-v1-shared/api";
import { beginLogin, completeLogin, completeSellerSelection, merchantRoute } from "./login";
import type { SessionStore } from "../store/session";

const authenticated: AuthResponse = {
  status: "authenticated",
  token: "operator-token",
  session: {
    operatorId: 1,
    sellerId: 7,
    sellerName: "桃子",
    role: "operator",
    expiresAt: "2027-01-01T00:00:00.000Z"
  }
};

const selection: AuthResponse = {
  status: "seller-selection-required",
  selectionToken: "selection-token",
  sellers: [{ sellerId: 7, sellerName: "桃子" }, { sellerId: 8, sellerName: "邻居" }]
};

const sessions = (): SessionStore => ({
  getSession: vi.fn(() => null),
  setSession: vi.fn(),
  clearSession: vi.fn()
});

describe("login platform flow", () => {
  it("uses dev login on H5", async () => {
    const api = { wxLogin: vi.fn(), devLogin: vi.fn(async () => authenticated) };
    await expect(beginLogin("h5", { api, wxCode: vi.fn(), devOpenid: "seed" })).resolves.toBe(authenticated);
    expect(api.devLogin).toHaveBeenCalledWith("seed");
    expect(api.wxLogin).not.toHaveBeenCalled();
  });

  it("uses wx.login only on weapp and never falls back to dev login", async () => {
    const api = { wxLogin: vi.fn(async () => authenticated), devLogin: vi.fn() };
    const wxCode = vi.fn(async () => "wx-code");
    await expect(beginLogin("weapp", { api, wxCode, devOpenid: "seed" })).resolves.toBe(authenticated);
    expect(api.wxLogin).toHaveBeenCalledWith("wx-code");
    api.wxLogin.mockRejectedValueOnce(new Error("wechat failed"));
    await expect(beginLogin("weapp", { api, wxCode, devOpenid: "seed" })).rejects.toThrow("wechat failed");
    expect(api.devLogin).not.toHaveBeenCalled();
  });
});

describe("login completion", () => {
  it("stores only authenticated sessions and routes to home", () => {
    const store = sessions();
    expect(completeLogin(authenticated, store)).toEqual({ next: "home" });
    expect(store.setSession).toHaveBeenCalledWith({ token: authenticated.token, ...authenticated.session });
    expect(JSON.stringify(vi.mocked(store.setSession).mock.calls)).not.toContain("openid");
  });

  it("requires explicit selection without defaulting or storing", () => {
    const store = sessions();
    expect(completeLogin(selection, store)).toEqual({
      next: "select-seller",
      selectionToken: "selection-token",
      sellers: selection.sellers
    });
    expect(store.setSession).not.toHaveBeenCalled();
  });

  it("stores the revalidated selected session", async () => {
    const store = sessions();
    const api = { selectSeller: vi.fn(async () => authenticated) };
    await expect(completeSellerSelection("selection", 7, api, store)).resolves.toEqual({ next: "home" });
    expect(api.selectSeller).toHaveBeenCalledWith("selection", 7);
    expect(store.setSession).toHaveBeenCalledOnce();
  });

  it("guards merchant routes", () => {
    expect(merchantRoute(null)).toBe("login");
    expect(merchantRoute({ token: "x" } as never)).toBe("home");
  });
});
