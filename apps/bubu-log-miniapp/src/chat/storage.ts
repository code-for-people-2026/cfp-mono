import Taro from "@tarojs/taro";
import { ChatDraftStore } from "./drafts";
export const chatDrafts = new ChatDraftStore({
  get: key => Taro.getStorageSync(key), set: (key, value) => Taro.setStorageSync(key, value), remove: key => Taro.removeStorageSync(key),
}, process.env.TARO_ENV === "weapp" ? BUBU_API_ORIGIN : "same-origin");
