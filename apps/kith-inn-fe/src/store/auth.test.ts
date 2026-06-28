import { describe, expect, it } from "vitest";
import { TOKEN_KEY, createTokenStore } from "./auth";
import type { Storage } from "./auth";

const mockStorage = (): Storage & { calls: { op: string; args: unknown[] }[] } => {
  const store = new Map<string, string>();
  const calls: { op: string; args: unknown[] }[] = [];
  return {
    calls,
    get: (k) => {
      calls.push({ op: "get", args: [k] });
      return store.get(k) ?? null;
    },
    set: (k, v) => {
      calls.push({ op: "set", args: [k, v] });
      store.set(k, v);
    },
    remove: (k) => {
      calls.push({ op: "remove", args: [k] });
      store.delete(k);
    },
  };
};

describe("createTokenStore", () => {
  it("round-trips a token under TOKEN_KEY", () => {
    const storage = mockStorage();
    const tokens = createTokenStore(storage);
    expect(tokens.getToken()).toBeNull();
    tokens.setToken("abc");
    expect(tokens.getToken()).toBe("abc");
    expect(storage.calls).toContainEqual({ op: "set", args: [TOKEN_KEY, "abc"] });
  });

  it("clearToken removes the token", () => {
    const storage = mockStorage();
    const tokens = createTokenStore(storage);
    tokens.setToken("abc");
    tokens.clearToken();
    expect(tokens.getToken()).toBeNull();
  });
});
