import { describe, expect, it } from "vitest";
import { issueToken, verifyToken } from "./jwt";

const SECRET = "test-secret";

describe("jwt issue/verify", () => {
  it("round-trips a token", async () => {
    const token = await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET);
    const payload = await verifyToken(token, SECRET);
    expect(payload).toMatchObject({ operatorId: 1, sellerId: 7, role: "owner" });
    expect(payload?.exp).toBeTypeOf("number");
  });

  it("rejects a tampered payload (signature mismatch)", async () => {
    const token = await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET);
    const [header, payload, sig] = token.split(".");
    const tamperedPayload = payload!.replace(/^./, "X");
    const tampered = `${header}.${tamperedPayload}.${sig}`;
    expect(await verifyToken(tampered, SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET);
    expect(await verifyToken(token, "other-secret")).toBeNull();
  });

  it("rejects a malformed token (wrong number of parts)", async () => {
    expect(await verifyToken("not.a.jwt.extra", SECRET)).toBeNull();
    expect(await verifyToken("onlyone", SECRET)).toBeNull();
  });

  it("rejects a token with a malformed (non-base64) segment", async () => {
    expect(await verifyToken("a.b.$", SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET, -10);
    expect(await verifyToken(token, SECRET)).toBeNull();
  });

  it("round-trips a token without an exp (ttlSeconds=null → no expiry check)", async () => {
    const token = await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET, null);
    const payload = await verifyToken(token, SECRET);
    expect(payload).toMatchObject({ operatorId: 1, sellerId: 7, role: "owner" });
    expect(payload?.exp).toBeUndefined();
  });
});
