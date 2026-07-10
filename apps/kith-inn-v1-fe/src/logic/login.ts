import type { AuthResponse } from "@cfp/kith-inn-v1-shared/api";
import type { SessionStore } from "../store/session";

type LoginApi = {
  wxLogin: (code: string) => Promise<AuthResponse>;
  devLogin: (openid: string) => Promise<AuthResponse>;
};

export function beginLogin(
  platform: "h5" | "weapp",
  deps: { api: LoginApi; wxCode: () => Promise<string>; devOpenid: string }
): Promise<AuthResponse> {
  return platform === "weapp"
    ? deps.wxCode().then((code) => deps.api.wxLogin(code))
    : deps.api.devLogin(deps.devOpenid);
}

export function completeLogin(response: AuthResponse, sessions: SessionStore) {
  if (response.status === "seller-selection-required") {
    return {
      next: "select-seller" as const,
      selectionToken: response.selectionToken,
      sellers: response.sellers
    };
  }
  sessions.setSession({ token: response.token, ...response.session });
  return { next: "offerings" as const };
}

export async function completeSellerSelection(
  selectionToken: string,
  sellerId: string | number,
  api: Pick<LoginApi & { selectSeller: (token: string, id: string | number) => Promise<AuthResponse> }, "selectSeller">,
  sessions: SessionStore
) {
  return completeLogin(await api.selectSeller(selectionToken, sellerId), sessions);
}

export function merchantRoute(session: unknown): "login" | "offerings" {
  return session ? "offerings" : "login";
}
