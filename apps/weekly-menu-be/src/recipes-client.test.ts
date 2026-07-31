import { describe, expect, it, vi } from "vitest";
import { fetchRecipePools } from "./recipes-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("fetchRecipePools", () => {
  it("reads the existing anonymous endpoint and returns only the generator fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        docs: [
          { id: 1, name: " 红烧肉 ", category: "big-meat", active: true, createdAt: "ignored" },
          { id: 2, name: "番茄炒蛋", category: "small-meat", active: true },
          { id: 3, name: "清炒时蔬", category: "vegetable", active: true }
        ],
        totalDocs: 3,
        page: 1
      })
    );

    await expect(fetchRecipePools("https://website.example.test/root", fetcher)).resolves.toEqual({
      bigMeat: ["红烧肉"],
      smallMeat: ["番茄炒蛋"],
      vegetable: ["清炒时蔬"]
    });
    const [request, init] = fetcher.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.origin + url.pathname).toBe("https://website.example.test/api/recipes");
    expect(url.searchParams.get("where[active][equals]")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("0");
    expect(init).toMatchObject({ method: "GET" });
  });

  it.each([
    { docs: [{ name: "停用菜", category: "vegetable", active: false }] },
    { docs: [{ name: "未知分类", category: "soup", active: true }] },
    { docs: [{ name: " ", category: "vegetable", active: true }] },
    { docs: "not-an-array" }
  ])("rejects a changed Payload contract", async (body) => {
    await expect(
      fetchRecipePools("https://website.example.test", async () => jsonResponse(body))
    ).rejects.toThrow("RECIPES_CONTRACT_INVALID");
  });

  it("reports an unavailable website without exposing its response", async () => {
    await expect(
      fetchRecipePools("https://website.example.test", async () =>
        jsonResponse({ internal: "do not expose" }, 503)
      )
    ).rejects.toThrow("RECIPES_UNAVAILABLE");
  });
});
