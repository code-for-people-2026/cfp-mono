import { describe, expect, it } from "vitest";
import { SessionCookies, type SessionStorage } from "../src/api/session";

function memory() {
  const map = new Map<string, unknown>();
  const storage: SessionStorage = { get: (key) => map.get(key), set: (key, value) => map.set(key, value), remove: (key) => { map.delete(key); } };
  return { storage, map };
}
describe("native Auth.js cookie lifecycle", () => {
  it("handles combined headers with Expires commas, chunks, expiry and deletion", () => {
    const { storage } = memory();
    let now = Date.parse("2026-10-23T00:00:00Z");
    const jar = new SessionCookies("https://baby.example.test", storage, () => now);
    jar.receive(["__Secure-authjs.session-token.0=one; Expires=Sat, 24 Oct 2026 00:00:00 GMT; Path=/; Secure, __Secure-authjs.session-token.1=two; Path=/; Secure; Max-Age=60"]);
    expect(jar.header("/api/app/auth/context")).toContain("__Secure-authjs.session-token.0=one");
    expect(jar.header("/api/app/auth/context")).toContain("__Secure-authjs.session-token.1=two");
    now += 61_000;
    expect(jar.header("/api/app/auth/context")).not.toContain("two");
    jar.receive(["__Secure-authjs.session-token.0=; Path=/; Secure; Max-Age=0"]);
    expect(jar.header("/api/app/auth/context")).toBe("");
  });
  it("ignores unrelated cookies, other domains and paths", () => {
    const { storage } = memory();
    const jar = new SessionCookies("https://baby.example.test", storage);
    jar.receive(["admin-token=never; Path=/", "authjs.session-token=foreign; Domain=other.test; Path=/", "authjs.csrf-token=csrf; Path=/api/auth", "authjs.callback-url=%2F; Domain=.example.test; Path=/"]);
    expect(jar.header("/api/app/auth/context")).toBe("authjs.callback-url=%2F");
    expect(jar.header("/api/auth/csrf")).toContain("authjs.csrf-token=csrf");
    expect(jar.header("/api/authentication")).not.toContain("csrf");
  });
  it("does not accept secure cookies over local HTTP or malformed persisted values", () => {
    const { storage, map } = memory();
    map.set("bubu-session:http://127.0.0.1:1030", { "authjs.session-token": { value: "bad\r\nvalue", path: "/", secure: false } });
    const jar = new SessionCookies("http://127.0.0.1:1030", storage);
    jar.receive(["__Secure-authjs.session-token=secure; Path=/; Secure", "authjs.csrf-token=local; Path=/"]);
    expect(jar.header("/api/auth/csrf")).toBe("authjs.csrf-token=local");
    jar.clear();
    expect(map.size).toBe(0);
  });
});
