// kith-inn-be address resolution + endpoint builders (pure, unit-tested). The
// pages do the actual Taro.request — keeping the network boundary in the UI layer
// (mirrors apps/community-cooking's split).

export const DEFAULT_BE_BASE_URL = "http://localhost:3310";

export function resolveBeBaseUrl(value?: string): string {
  const baseUrl = value?.trim() || DEFAULT_BE_BASE_URL;
  return baseUrl.replace(/\/+$/, "");
}

export function beBaseUrl(): string {
  return resolveBeBaseUrl(process.env.BE_BASE_URL);
}

export function wxLoginUrl(): string {
  return `${beBaseUrl()}/auth/wx-login`;
}

export function devLoginUrl(): string {
  return `${beBaseUrl()}/auth/dev-login`;
}

export function offeringsUrl(): string {
  return `${beBaseUrl()}/offerings`;
}

export function menuWeekUrl(): string {
  return `${beBaseUrl()}/menu/week`;
}
