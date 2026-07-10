import { describe, expect, it, vi } from "vitest";
import { SESSION_KEY, createSessionStore, parseOperatorSessionData, type OperatorSession, type Storage } from "./session";

const session: OperatorSession = {
  token: "operator-token",
  operatorId: 1,
  sellerId: 7,
  sellerName: "桃子",
  role: "operator",
  expiresAt: "2027-01-01T00:00:00.000Z"
};

function memoryStorage(initial?: string): Storage & { value: string | null } {
  return {
    value: initial ?? null,
    get() { return this.value; },
    set(_key, value) { this.value = value; },
    remove() { this.value = null; }
  };
}

describe("session store", () => {
  it("stores only the operator session allowlist and never openid", () => {
    const storage = memoryStorage();
    const store = createSessionStore(storage);
    store.setSession({ ...session, openid: "must-not-persist", ignored: true } as OperatorSession);
    expect(storage.value).not.toContain("openid");
    expect(storage.value).not.toContain("must-not-persist");
    expect(store.getSession()).toEqual(session);
    expect(SESSION_KEY).toBe("kith_inn_v1_operator_session");
  });

  it("returns null for absent/invalid storage and clears explicitly", () => {
    expect(createSessionStore(memoryStorage()).getSession()).toBeNull();
    const invalid = memoryStorage("not-json");
    expect(createSessionStore(invalid).getSession()).toBeNull();
    const emptyToken = memoryStorage(JSON.stringify({ token: "" }));
    expect(createSessionStore(emptyToken).getSession()).toBeNull();
    const incomplete = memoryStorage(JSON.stringify({ token: "x" }));
    expect(createSessionStore(incomplete).getSession()).toBeNull();
    const storage = memoryStorage(JSON.stringify(session));
    const remove = vi.spyOn(storage, "remove");
    createSessionStore(storage).clearSession();
    expect(remove).toHaveBeenCalledWith(SESSION_KEY);
    expect(storage.value).toBeNull();
    expect(parseOperatorSessionData(null)).toBeNull();
    expect(parseOperatorSessionData({ ...session, sellerId: "seller-7" })).toMatchObject({ sellerId: "seller-7" });
    expect(parseOperatorSessionData({ ...session, operatorId: 1.5 })).toBeNull();
  });
});
