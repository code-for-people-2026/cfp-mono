import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/chat", () => {
  it("returns a friendly 400 for invalid JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: "{not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "请求格式不对，可以刷新页面后再试。",
    });
  });
});
