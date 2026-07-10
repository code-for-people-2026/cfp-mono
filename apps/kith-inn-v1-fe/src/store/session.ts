import type { OperatorSessionData } from "@cfp/kith-inn-v1-shared/api";

export const SESSION_KEY = "kith_inn_v1_operator_session";

export type OperatorSession = OperatorSessionData & { token: string };

export type Storage = {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
};

export type SessionStore = {
  getSession: () => OperatorSession | null;
  setSession: (session: OperatorSession) => void;
  clearSession: () => void;
};

function validId(value: unknown): value is string | number {
  return (typeof value === "string" && value !== "") || (typeof value === "number" && Number.isInteger(value));
}

export function parseOperatorSessionData(value: unknown): OperatorSessionData | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const session = value as Partial<OperatorSessionData>;
  return validId(session.operatorId) && validId(session.sellerId) &&
    typeof session.sellerName === "string" && session.sellerName !== "" &&
    session.role === "operator" && typeof session.expiresAt === "string" && !Number.isNaN(Date.parse(session.expiresAt))
    ? session as OperatorSessionData
    : null;
}

function parseSession(value: string): OperatorSession | null {
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    if (typeof raw.token !== "string" || raw.token === "") return null;
    const { token, ...data } = raw;
    const session = parseOperatorSessionData(data);
    return session ? { token, ...session } : null;
  } catch {
    return null;
  }
}

export function createSessionStore(storage: Storage): SessionStore {
  return {
    getSession() {
      const value = storage.get(SESSION_KEY);
      return value ? parseSession(value) : null;
    },
    setSession(session) {
      const safe: OperatorSession = {
        token: session.token,
        operatorId: session.operatorId,
        sellerId: session.sellerId,
        sellerName: session.sellerName,
        role: "operator",
        expiresAt: session.expiresAt
      };
      storage.set(SESSION_KEY, JSON.stringify(safe));
    },
    clearSession() {
      storage.remove(SESSION_KEY);
    }
  };
}
