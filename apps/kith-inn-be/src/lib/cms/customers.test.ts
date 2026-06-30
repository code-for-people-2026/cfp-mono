import { afterEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_JWT_HEADER } from "./client";
import { listCustomers } from "./customers";

const ORIG = process.env.CMS_BASE_URL;
afterEach(() => {
  process.env.CMS_BASE_URL = ORIG;
  vi.unstubAllGlobals();
});

const mockFetch = (response: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status })),
});

describe("listCustomers", () => {
  it("GETs /api/internal/customers with an optional name filter and unwraps {docs}", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ docs: [{ id: 5, displayName: "王燕萍" }] });
    const customers = await listCustomers("jwt", { name: "王" }, deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toContain("/api/internal/customers?name=");
    expect(customers).toEqual([{ id: 5, displayName: "王燕萍" }]);
    expect(deps.fetch.mock.calls[0]![1]?.headers).toMatchObject({ [OPERATOR_JWT_HEADER]: "jwt" });
  });

  it("omits the query string when no name and returns [] when docs is absent", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({});
    const customers = await listCustomers("jwt", {}, deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/customers");
    expect(customers).toEqual([]);
  });

  it("throws on a non-2xx", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = { fetch: vi.fn(async () => new Response("err", { status: 500 })) };
    await expect(listCustomers("jwt", {}, deps)).rejects.toThrow(/500/);
  });

  it("uses global fetch when deps are omitted", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ docs: [{ id: 1 }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await listCustomers("jwt"))[0]?.id).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
