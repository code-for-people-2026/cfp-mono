import type { CustomerSessionResponse } from "@cfp/kith-inn-v1-shared";

export const CUSTOMER_SESSION_KEY = "kith_inn_v1_customer_session";
export type CustomerSession = CustomerSessionResponse["session"] & { token: string };

export type CustomerStorage = {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
};

export type CustomerSessionStore = {
  getSession: () => CustomerSession | null;
  setSession: (session: CustomerSession) => void;
  clearSession: () => void;
};

function parse(value: string): CustomerSession | null {
  try {
    const session = JSON.parse(value) as Partial<CustomerSession>;
    return typeof session.token === "string" && session.token !== "" &&
      typeof session.sellerName === "string" && session.sellerName !== "" &&
      session.role === "customer" && typeof session.expiresAt === "string" &&
      !Number.isNaN(Date.parse(session.expiresAt))
      ? {
          token: session.token,
          sellerName: session.sellerName,
          role: "customer",
          expiresAt: session.expiresAt
        }
      : null;
  } catch {
    return null;
  }
}

export function createCustomerSessionStore(storage: CustomerStorage): CustomerSessionStore {
  return {
    getSession() {
      const value = storage.get(CUSTOMER_SESSION_KEY);
      return value ? parse(value) : null;
    },
    setSession(session) {
      storage.set(CUSTOMER_SESSION_KEY, JSON.stringify({
        token: session.token,
        sellerName: session.sellerName,
        role: "customer",
        expiresAt: session.expiresAt
      }));
    },
    clearSession() {
      storage.remove(CUSTOMER_SESSION_KEY);
    }
  };
}
