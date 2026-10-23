import Taro from "@tarojs/taro";
import { createBubuApi, type Transport } from "./client";

export { ApiError, ConfigurationError, ACTIVITY_LIMIT } from "./client";
export type { BubuApi, ActivityQuery, ActivityResult } from "./client";

const native = process.env.TARO_ENV === "weapp";
const transport: Transport = async (request) => {
  if (!native) {
    const response = await fetch(request.url, {
      method: request.method, headers: request.headers, body: request.body,
      credentials: "same-origin",
    });
    return { status: response.status, data: await response.json() };
  }
  const response = await Taro.request<unknown>({
    url: request.url, method: request.method, header: request.headers,
    ...(request.body !== undefined ? { data: request.body } : {}),
    dataType: "json", timeout: 30_000,
  });
  return { status: response.statusCode, data: response.data, headers: response.header, cookies: response.cookies };
};

export const api = createBubuApi({
  native, origin: BUBU_API_ORIGIN, transport,
  storage: {
    get: (key) => Taro.getStorageSync<unknown>(key),
    set: (key, value) => Taro.setStorageSync(key, value),
    remove: (key) => Taro.removeStorageSync(key),
  },
});
