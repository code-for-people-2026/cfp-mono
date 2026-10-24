import { describe, it, expect } from "vitest";
import { coreAccess, mutationAccess } from "../src/security";
import { profileOwnersFromEnv } from "../src/lifecycle";
const token = "a".repeat(64);
const env = { BUBU_CORE_SERVICE_TOKEN: token, BUBU_CORE_DATABASE_URL: "postgresql://127.0.0.1/test", BUBU_CORE_PAYLOAD_SECRET: "c".repeat(64), AUTH_SECRET: "d".repeat(64) };
const request = (key?: string) => new Request("http://127.0.0.1:3321/api/babies", { headers: key ? { "x-bubu-core-token": key } : {} });
describe("private original data boundary", () => {
  it("fails closed before credentials/database are configured", () => {
    expect(coreAccess(request(token), {})?.status).toBe(503);
    expect(coreAccess(request(token), { ...env, AUTH_SECRET: "" })?.status).toBe(503);
    expect(coreAccess(request(token), { ...env, BUBU_CORE_DATABASE_URL: "postgresql://old-public.example/production" })?.status).toBe(503);
  });
  it("requires the private token even for loopback requests", () => {
    expect(coreAccess(request(), env)?.status).toBe(401);
    expect(coreAccess(request("b".repeat(64)), env)?.status).toBe(401);
    expect(coreAccess(request("é".repeat(64)), env)?.status).toBe(401);
    expect(coreAccess(request(token), env)).toBeUndefined();
  });
  it("keeps writes disabled until explicit cutover", () => {
    expect(mutationAccess({})?.status).toBe(503);
    expect(mutationAccess({ BUBU_CORE_WRITES_ENABLED: "yes" })?.status).toBe(503);
    expect(mutationAccess({ BUBU_CORE_WRITES_ENABLED: "true" })).toBeUndefined();
  });
  it("accepts only explicit old profile ownership mappings", () => {
    expect(profileOwnersFromEnv('{"default":"baby-a"}')).toEqual({ default: "baby-a" });
    for (const invalid of ['[]', 'null', '{"default":2}', '{"default":""}']) expect(() => profileOwnersFromEnv(invalid)).toThrow();
  });
});
