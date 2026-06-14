export const defaultApiBaseUrl = "http://localhost:3300";

export function resolveApiBaseUrl(value?: string) {
  const baseUrl = value?.trim() || defaultApiBaseUrl;
  return baseUrl.replace(/\/+$/, "");
}

export function createMiniappDemoUrl(baseUrl?: string) {
  return `${resolveApiBaseUrl(baseUrl)}/api/miniapp/demo`;
}

