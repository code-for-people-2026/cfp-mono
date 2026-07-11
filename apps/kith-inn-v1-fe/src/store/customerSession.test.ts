import { describe, expect, it, vi } from "vitest";
import {
  CUSTOMER_SESSION_KEY,
  createCustomerSessionStore,
  type CustomerSession,
  type CustomerStorage
} from "./customerSession";

const session: CustomerSession = {
  token: "customer-token",
  sellerName: "桃子",
  role: "customer",
  expiresAt: "2027-01-01T00:00:00.000Z"
};

function memory(initial?: string): CustomerStorage & { value: string | null } {
  return {
    value: initial ?? null,
    get() { return this.value; },
    set(_key, value) { this.value = value; },
    remove() { this.value = null; }
  };
}

describe("customer session store", () => {
  it("uses an independent key and persists only the public allowlist", () => {
    const storage = memory();
    const store = createCustomerSessionStore(storage);
    store.setSession({ ...session, sellerId: 7, openid: "leak" } as CustomerSession);
    expect(CUSTOMER_SESSION_KEY).toBe("kith_inn_v1_customer_session");
    expect(storage.value).not.toMatch(/sellerId|openid|leak/);
    expect(store.getSession()).toEqual(session);
  });

  it("fails closed for invalid data and clears only its own key", () => {
    for (const value of [undefined, "bad", JSON.stringify({ token: "" }), JSON.stringify({ ...session, expiresAt: "bad" })]) {
      expect(createCustomerSessionStore(memory(value)).getSession()).toBeNull();
    }
    const storage = memory(JSON.stringify(session));
    const remove = vi.spyOn(storage, "remove");
    createCustomerSessionStore(storage).clearSession();
    expect(remove).toHaveBeenCalledWith(CUSTOMER_SESSION_KEY);
  });
});
