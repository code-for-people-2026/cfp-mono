import { describe, expect, it } from "vitest";
import { cmsAuthenticated } from "./cmsAuthenticated";

describe("cmsAuthenticated", () => {
  it("允许共享 CMS 已认证用户", () => {
    expect(cmsAuthenticated({ req: { user: { id: 1 } } })).toBe(true);
  });

  it("默认拒绝未认证请求", () => {
    expect(cmsAuthenticated({ req: {} })).toBe(false);
    expect(cmsAuthenticated({ req: { user: null } })).toBe(false);
  });
});
