import { describe, expect, it, vi } from "vitest";
import { createBubuApi, type TransportResponse } from "../src/api/client";
import { policy } from "./fixtures/privacy";

describe.each([true, false])("public policy with native=%s", native => {
  it("loads and retries policy after a guest context 401, regardless of response order", async () => {
    let resolvePolicy!: (response: TransportResponse) => void;
    const api = createBubuApi({ native, origin: "https://example.test", authMode: "sidecar",
      storage: { get: () => undefined, set: () => {}, remove: () => {} },
      transport: async request => request.url.endsWith("/privacy/policy")
        ? new Promise(resolve => { resolvePolicy = resolve; })
        : { status: 401, data: { code: "UNAUTHORIZED" } },
    });
    const pending = api.privacyPolicy();
    expect(await api.getContext()).toMatchObject({ authenticated: false });
    resolvePolicy({ status: 200, data: policy });
    await expect(pending).resolves.toEqual(policy);
    const retry = api.privacyPolicy();
    resolvePolicy({ status: 200, data: policy });
    await expect(retry).resolves.toEqual(policy);
  });

  it("does not expire an existing identity if the public policy endpoint fails", async () => {
    const remove = vi.fn(), expired = vi.fn();
    const api = createBubuApi({ native, origin: "https://example.test", authMode: "sidecar",
      storage: { get: () => ({ token: "synthetic-token", expiresAt: "2099-01-01T00:00:00Z" }), set: () => {}, remove },
      onSessionExpired: expired,
      transport: async request => {
        expect(request.headers.Authorization).toBeUndefined();
        return { status: 401, data: { error: "Policy unavailable" } };
      },
    });
    await expect(api.privacyPolicy()).rejects.toMatchObject({ status: 401 });
    expect(expired).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
