import { expect, it, vi } from "vitest";

it("validates login and rejects extra fields when WeChat cannot compile Function bodies", async () => {
  vi.stubEnv("TARO_ENV", "weapp");
  // WeChat's Function stub can pass a construction probe without producing a function.
  vi.stubGlobal("Function", function () {});
  try {
    await import("./app");
    const { LoginInputSchema, DishBatchInputSchema } = await import("@cfp/kith-inn-contracts");
    expect(LoginInputSchema.parse({ code: "one-use-code" })).toEqual({ code: "one-use-code" });
    expect(LoginInputSchema.safeParse({ code: "one-use-code", owner: true }).success).toBe(false);
    expect(DishBatchInputSchema.safeParse({ items: [{ name: "番茄汤", category: "soup" }] }).success).toBe(true);
    expect(DishBatchInputSchema.safeParse({ items: [{ name: "番茄汤", category: "invalid" }] }).success).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
