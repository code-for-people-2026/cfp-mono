import { trackImageFile, removeImageFile, clearImageFiles } from "../chat/files";
import { chatDrafts } from "../chat/storage";
import Taro from "@tarojs/taro";
import { createBubuApi, type Transport } from "./client";
import { sessionExpiredEvent } from "../navigation/events";

export { ApiError, ConfigurationError, ACTIVITY_LIMIT } from "./client";
export type { BubuApi, ActivityQuery, ActivityResult } from "./client";

const native = process.env.TARO_ENV === "weapp";
export const identityEnabled = BUBU_AUTH_MODE === "sidecar";
export const wechatIdentityEnabled = native && identityEnabled;
const transport: Transport = async (request) => {
  if (!native) {
    const response = await fetch(request.url, {
      method: request.method, headers: request.headers, body: request.binary ?? request.body,
      credentials: "same-origin",
    });
    return { status: response.status, data: await response.json() };
  }
  const response = await Taro.request<unknown>({
    url: request.url, method: request.method, header: request.headers,
    ...(request.binary !== undefined || request.body !== undefined ? { data: request.binary ?? request.body } : {}),
    dataType: "json", timeout: 30_000,
  });
  return { status: response.statusCode, data: response.data, headers: response.header, cookies: response.cookies };
};

export const api = createBubuApi({
  native, origin: BUBU_API_ORIGIN, transport,
  authMode: BUBU_AUTH_MODE,
  wechatLogin: async () => (await Taro.login()).code,
  onAccessRevoked: (babyId) => { clearImageFiles(); if (babyId) chatDrafts.clearBaby(babyId); else chatDrafts.clear(); },
  onSessionExpired: () => Taro.eventCenter.trigger(sessionExpiredEvent),
  download: async (request) => {
    const response = await Taro.downloadFile({ url: request.url, header: request.headers });
    trackImageFile(response.tempFilePath);
    return { status: response.statusCode, path: response.tempFilePath };
  },
  removeDownloadedFile: removeImageFile,
  storage: {
    get: (key) => Taro.getStorageSync<unknown>(key),
    set: (key, value) => Taro.setStorageSync(key, value),
    remove: (key) => Taro.removeStorageSync(key),
  },
});
