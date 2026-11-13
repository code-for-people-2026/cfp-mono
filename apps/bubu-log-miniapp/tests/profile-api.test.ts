import { describe, expect, it } from "vitest";
import { createBubuApi, type Transport, type TransportRequest, type TransportResponse } from "../src/api/client";
import { ResponseFormatError } from "../src/api/contracts";
import type { SessionStorage } from "../src/api/session";

const storage = (): { store: SessionStorage; values: Map<string, unknown> } => {
  const values = new Map<string, unknown>();
  return {
    values,
    store: {
      get: (key) => values.get(key),
      remove: (key) => { values.delete(key); },
      set: (key, value) => { values.set(key, value); },
    },
  };
};
const response = (data: unknown, status = 200, cookies?: string[]): TransportResponse => ({ status, data, cookies });
const fixture = (transport: Transport, saved = storage()) => ({
  client: createBubuApi({ native: true, origin: "https://baby.example.test", storage: saved.store, transport }),
  values: saved.values,
});

describe("existing baby profile endpoint", () => {
  it("makes a scoped GET with the baby query and header", async () => {
    const requests: TransportRequest[] = [];
    const { client } = fixture(async (request) => {
      requests.push(request);
      return response({ id: "baby-1", name: "小满", fullName: "满月", avatarUrl: "https://cdn.example.test/a.png", birthDate: "2026-01-02T00:00:00.000Z" });
    });

    await expect(client.getBabyProfile("baby-1")).resolves.toEqual({
      id: "baby-1", name: "小满", fullName: "满月", avatarUrl: "https://cdn.example.test/a.png", birthDate: "2026-01-02T00:00:00.000Z",
    });
    expect(requests).toEqual([{
      credentials: undefined,
      headers: { Accept: "application/json", "x-baby-id": "baby-1" },
      method: "GET",
      url: "https://baby.example.test/api/app/baby-profile?babyId=baby-1",
    }]);
  });

  it("decodes the birthday and rejects an undecodable date", async () => {
    const { client } = fixture(async (request) => {
      expect(request.url).toContain("babyId=baby-1");
      return response({ id: "baby-1", name: "宝宝", fullName: null, avatarUrl: null, birthDate: "not-a-date" });
    });

    await expect(client.getBabyProfile("baby-1")).rejects.toBeInstanceOf(ResponseFormatError);
  });

  it("never falls back to another baby when the returned id differs", async () => {
    const { client } = fixture(async () => response({ id: "baby-2", name: "另一个宝宝", fullName: null, avatarUrl: null, birthDate: null }));

    await expect(client.getBabyProfile("baby-1")).rejects.toBeInstanceOf(ResponseFormatError);
  });

  it("reports expired sessions without accepting an unauthorized payload", async () => {
    const saved = storage();
    saved.values.set("bubu-session:https://baby.example.test", { "authjs.session-token": { value: "token", path: "/", secure: true } });
    const { client, values } = fixture(async (request) => {
      expect(request.headers.Cookie).toBe("authjs.session-token=token");
      return response({ id: "baby-1", name: "宝宝" }, 401);
    }, saved);

    await expect(client.getBabyProfile("baby-1")).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(values.size).toBe(0);
  });
});
