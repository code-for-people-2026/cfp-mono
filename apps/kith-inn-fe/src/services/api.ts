// kith-inn-be address resolution + endpoint builders (pure, unit-tested). The
// pages do the actual Taro.request — keeping the network boundary in the UI layer
// (mirrors apps/community-cooking's split).

export const DEFAULT_BE_BASE_URL = "http://192.168.31.120:3310";

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

export function offeringDetailUrl(id: string | number): string {
  return `${beBaseUrl()}/offerings/${id}`;
}

export function menuWeekUrl(): string {
  return `${beBaseUrl()}/menu/week`;
}

export function ordersUrl(date?: string): string {
  return `${beBaseUrl()}/orders${date ? `?date=${encodeURIComponent(date)}` : ""}`;
}

export function orderUrl(id: string | number): string {
  return `${beBaseUrl()}/orders/${id}`;
}

export function orderConfirmUrl(id: string | number): string {
  return `${beBaseUrl()}/orders/${id}/confirm`;
}

export function deliveryUrl(date?: string, occasion?: string): string {
  const qs = new URLSearchParams();
  if (date) qs.set("date", date);
  if (occasion) qs.set("occasion", occasion);
  const tail = qs.toString();
  return `${beBaseUrl()}/delivery${tail ? `?${tail}` : ""}`;
}

export function markDeliveredUrl(): string {
  return `${beBaseUrl()}/delivery/fulfillments`;
}

export function chatUrl(): string {
  return `${beBaseUrl()}/chat`;
}

export function confirmCustomersUrl(): string {
  return `${beBaseUrl()}/chat/confirm-customers`;
}

export function menuPlansUrl(date?: string): string {
  return `${beBaseUrl()}/menu/plans${date ? `?date=${encodeURIComponent(date)}` : ""}`;
}

export function menuPlansRangeUrl(from: string, to: string): string {
  return `${beBaseUrl()}/menu/plans?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

export function menuGenerateUrl(): string {
  return `${beBaseUrl()}/menu/generate`;
}

export function menuPlanSwapUrl(id: string | number): string {
  return `${beBaseUrl()}/menu/plans/${id}/swap`;
}

export function menuPlanPublishUrl(id: string | number): string {
  return `${beBaseUrl()}/menu/plans/${id}/publish`;
}
