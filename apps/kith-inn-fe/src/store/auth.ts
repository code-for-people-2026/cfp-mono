// Token persistence. Pure factory over an injected storage adapter so it's
// unit-testable without Taro; the pages wire the Taro storage adapter (the
// actual Taro.getStorageSync calls live in the UI layer, not here).

export const TOKEN_KEY = "kith_inn_token";

export type Storage = {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
};

export type TokenStore = {
  getToken: () => string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
};

export function createTokenStore(storage: Storage): TokenStore {
  return {
    getToken: () => storage.get(TOKEN_KEY),
    setToken: (token) => storage.set(TOKEN_KEY, token),
    clearToken: () => storage.remove(TOKEN_KEY),
  };
}
