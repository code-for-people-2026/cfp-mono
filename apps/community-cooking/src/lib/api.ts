// 历史过渡 helper：只构造 apps/website 的匿名只读 recipes URL，当前没有调用方。
// ponytail: #317 将以 Weekly Menu API adapter 取代它；小程序不得直连 Payload。

export const defaultApiBaseUrl = "http://localhost:3302";

export function resolveApiBaseUrl(value?: string) {
  const baseUrl = value?.trim() || defaultApiBaseUrl;
  return baseUrl.replace(/\/+$/, "");
}

// Payload 会按集合 slug 自动生成 REST 接口；这里仅保留 URL 契约的既有测试证据。
// limit=0 关闭分页（Payload 默认每页仅 10 条）；where[active] 过滤掉运营停用的菜品，
// 后续只能由 weekly-menu-be 服务端使用同等只读查询并转换为最小 DTO。
export function createRecipesUrl(baseUrl?: string) {
  return `${resolveApiBaseUrl(baseUrl)}/api/recipes?where[active][equals]=true&limit=0`;
}
