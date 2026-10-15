import Taro from "@tarojs/taro";
import type { PrivacyStatus } from "./privacy";

export const privacyChangedEvent = "hello:privacy-changed";
export type PrivacyChange = { status?: PrivacyStatus; clearIdentity?: boolean };
export function notifyPrivacyChange(change: PrivacyChange) { Taro.eventCenter.trigger(privacyChangedEvent, change); }
export function openPrivacy(section?: string) {
  return Taro.navigateTo({ url: section ? `/pages/privacy/${section}/index` : "/pages/privacy/index" });
}
export function openHelp(turnId?: number, category?: string) {
  const query = turnId ? `?turnId=${turnId}` : category === "privacy" ? "?category=privacy" : "";
  return Taro.navigateTo({ url: `/pages/help/index${query}` });
}
