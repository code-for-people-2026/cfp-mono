// 小程序与后端 CMS（apps/website 的 Payload）之间的地址解析。
// 菜品数据不再写死在前端，而是从 CMS 的「菜谱库」集合按需拉取。

export const defaultApiBaseUrl = "http://localhost:3302";

export function resolveApiBaseUrl(value?: string) {
  const baseUrl = value?.trim() || defaultApiBaseUrl;
  return baseUrl.replace(/\/+$/, "");
}

// Payload 会按集合 slug 自动生成 REST 接口；菜谱库集合（slug: recipes，在 apps/website）在此读取。
// limit=0 关闭分页（Payload 默认每页仅 10 条）；where[active] 过滤掉运营停用的菜品，
// 这样拿到的是「完整的启用菜品池」，交给生成逻辑才正确。
export function createRecipesUrl(baseUrl?: string) {
  return `${resolveApiBaseUrl(baseUrl)}/api/recipes?where[active][equals]=true&limit=0`;
}
