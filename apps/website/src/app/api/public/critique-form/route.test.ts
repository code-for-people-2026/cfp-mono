import { afterEach, describe, expect, it, vi } from "vitest";

const payloadMocks = vi.hoisted(() => ({ getPayload: vi.fn() }));

vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()),
  getPayload: payloadMocks.getPayload,
}));

import { GET, OPTIONS } from "./route";

const endpoint = "https://www.codeforpeople.cn/api/public/critique-form";
const idealOrigin = "https://ideal.codeforpeople.cn";

function request(origin?: string) {
  return new Request(endpoint, origin === undefined ? undefined : { headers: { Origin: origin } });
}

function payloadResult(
  docs: unknown[],
  pagination: { nextPage?: number | null } = {},
) {
  return { docs, nextPage: pagination.nextPage ?? null };
}

afterEach(() => {
  payloadMocks.getPayload.mockReset();
});

describe("GET /api/public/critique-form", () => {
  it("returns only the first valid critique label and HTTPS URL to the exact ideal origin", async () => {
    const find = vi
      .fn()
      .mockResolvedValueOnce(
        payloadResult([{ label: "不安全入口", url: "http://example.com/form" }], { nextPage: 2 }),
      )
      .mockResolvedValueOnce(
        payloadResult([
          {
            id: 42,
            label: "  提出批评  ",
            purpose: "critique",
            url: " https://forms.example.com/critique ",
            createdAt: "2026-08-22T00:00:00.000Z",
            updatedAt: "2026-08-22T01:00:00.000Z",
            adminOnly: "never expose",
          },
        ]),
      );
    payloadMocks.getPayload.mockResolvedValue({ find });

    const response = await GET(request(idealOrigin));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(idealOrigin);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      label: "提出批评",
      url: "https://forms.example.com/critique",
    });
    expect(find).toHaveBeenNthCalledWith(1, {
      collection: "form-links",
      where: { purpose: { equals: "critique" } },
      sort: "createdAt",
      page: 1,
      limit: 1,
      depth: 0,
      select: { label: true, url: true },
      overrideAccess: true,
    });
    expect(find).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
  });

  it("returns unavailable when no critique form is configured", async () => {
    payloadMocks.getPayload.mockResolvedValue({
      find: vi.fn(async () => payloadResult([])),
    });

    const response = await GET(request(idealOrigin));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ unavailable: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["an empty label", { label: "", url: "https://forms.example.com/critique" }],
    ["an invalid URL", { label: "提出批评", url: "not a url" }],
    ["a non-HTTPS URL", { label: "提出批评", url: "http://forms.example.com/critique" }],
  ])("fails closed for %s", async (_case, document) => {
    payloadMocks.getPayload.mockResolvedValue({
      find: vi.fn(async () => payloadResult([document])),
    });

    const response = await GET(request(idealOrigin));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ unavailable: true });
  });

  it("does not disclose a usable form to any other origin", async () => {
    const find = vi.fn();
    payloadMocks.getPayload.mockResolvedValue({ find });

    const response = await GET(request("https://ideal.codeforpeople.cn.evil.example"));

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ unavailable: true });
    expect(find).not.toHaveBeenCalled();
  });

  it("allows a same-origin-style request without an Origin header", async () => {
    payloadMocks.getPayload.mockResolvedValue({
      find: vi.fn(async () =>
        payloadResult([{ label: "提出批评", url: "https://forms.example.com/critique" }]),
      ),
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      label: "提出批评",
      url: "https://forms.example.com/critique",
    });
  });

  it("reports database errors as unavailable without leaking details", async () => {
    payloadMocks.getPayload.mockRejectedValue(new Error("password=do-not-leak"));

    const response = await GET(request(idealOrigin));

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe(idealOrigin);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ unavailable: true });
  });
});

describe("OPTIONS /api/public/critique-form", () => {
  it("authorizes only GET and OPTIONS for the exact ideal origin", () => {
    const response = OPTIONS(request(idealOrigin));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(idealOrigin);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("Accept");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not authorize another origin", () => {
    const response = OPTIONS(request("https://example.com"));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
