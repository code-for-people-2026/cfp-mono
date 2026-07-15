import { describe, expect, it, vi } from "vitest";
import {
  runDeployedSmoke,
  runDeployedSmokeCli,
  type DeployedSmokeDeps,
  type DeployedSmokeInput,
} from "./deployed";

const privateOpenid = "openid-private-value";
const privateJwt = "jwt-private-value";
const privateToken = "header.private-token.signature";
const input: DeployedSmokeInput = {
  openid: privateOpenid,
  provisionedSellerId: "7",
  jwtSecret: privateJwt,
  beBaseUrl: "http://127.0.0.1:3310",
  ttlSeconds: 60,
};

function deps(overrides: Partial<DeployedSmokeDeps> = {}): DeployedSmokeDeps {
  const signal = new AbortController().signal;
  return {
    findOperatorByOpenid: vi.fn().mockResolvedValue({ id: 3, sellerId: 7, role: "owner", active: true }),
    issueToken: vi.fn().mockResolvedValue(privateToken),
    fetch: vi.fn().mockResolvedValue(Response.json({ offerings: [{ id: 1 }, { id: 2 }] })),
    timeoutSignal: vi.fn().mockReturnValue(signal),
    ...overrides,
  };
}

describe("runDeployedSmoke", () => {
  it("uses a 60-second operator JWT for one read-only offerings request", async () => {
    const boundary = deps();

    await expect(runDeployedSmoke(input, boundary)).resolves.toEqual({
      status: "passed",
      sellerId: "7",
      offeringCount: 2,
      ttlSeconds: 60,
    });
    expect(boundary.findOperatorByOpenid).toHaveBeenCalledWith(privateOpenid, expect.any(AbortSignal));
    expect(boundary.issueToken).toHaveBeenCalledWith(
      { operatorId: 3, sellerId: 7, role: "owner" },
      privateJwt,
      60,
    );
    expect(boundary.fetch).toHaveBeenCalledWith("http://127.0.0.1:3310/offerings", expect.objectContaining({
      method: "GET",
      headers: { authorization: `Bearer ${privateToken}` },
      signal: expect.any(AbortSignal),
    }));
    expect(boundary.timeoutSignal).toHaveBeenNthCalledWith(1, 5_000);
    expect(boundary.timeoutSignal).toHaveBeenNthCalledWith(2, 5_000);
    expect(JSON.stringify(await runDeployedSmoke(input, deps()))).not.toMatch(/private|openid/);
  });

  it.each([
    ["missing", null],
    ["inactive", { id: 3, sellerId: 7, role: "owner", active: false }],
  ])("fails closed when the operator is %s", async (_label, operator) => {
    await expect(runDeployedSmoke(input, deps({ findOperatorByOpenid: vi.fn().mockResolvedValue(operator) })))
      .rejects.toMatchObject({ code: "operator_not_provisioned" });
  });

  it("rejects an operator bound to a different seller before issuing a token", async () => {
    const boundary = deps({
      findOperatorByOpenid: vi.fn().mockResolvedValue({ id: 3, sellerId: 8, role: "owner", active: true }),
    });

    await expect(runDeployedSmoke(input, boundary)).rejects.toMatchObject({ code: "seller_mismatch" });
    expect(boundary.issueToken).not.toHaveBeenCalled();
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it.each([0, 61, 1.5])("rejects invalid TTL %s", async (ttlSeconds) => {
    await expect(runDeployedSmoke({ ...input, ttlSeconds }, deps()))
      .rejects.toMatchObject({ code: "invalid_configuration" });
  });

  it.each(["openid", "provisionedSellerId", "jwtSecret", "beBaseUrl"] as const)(
    "rejects a missing %s",
    async (field) => {
      await expect(runDeployedSmoke({ ...input, [field]: " " }, deps()))
        .rejects.toMatchObject({ code: "invalid_configuration" });
    },
  );

  it.each([
    "https://attacker.example",
    "ftp://127.0.0.1:3310",
    "http://user:password@127.0.0.1:3310",
    "http://127.0.0.1:3310/path",
    "http://127.0.0.1:3310?query=1",
    "http://127.0.0.1:3310#fragment",
  ])("rejects a token-exfiltrating or non-origin BE URL %s", async (beBaseUrl) => {
    const boundary = deps();
    await expect(runDeployedSmoke({ ...input, beBaseUrl }, boundary))
      .rejects.toMatchObject({ code: "invalid_configuration" });
    expect(boundary.issueToken).not.toHaveBeenCalled();
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("sanitizes operator lookup and token issue failures", async () => {
    await expect(runDeployedSmoke(input, deps({
      findOperatorByOpenid: vi.fn().mockRejectedValue(new DOMException(privateOpenid, "TimeoutError")),
    }))).rejects.toMatchObject({ code: "operator_lookup_failed", message: "operator_lookup_failed" });
    await expect(runDeployedSmoke(input, deps({
      issueToken: vi.fn().mockRejectedValue(new Error(privateJwt)),
    }))).rejects.toMatchObject({ code: "token_issue_failed", message: "token_issue_failed" });
  });

  it.each([
    vi.fn().mockRejectedValue(new Error(privateToken)),
    vi.fn().mockResolvedValue(new Response("private upstream", { status: 503 })),
    vi.fn().mockResolvedValue(Response.json({ docs: [] })),
  ])("sanitizes offerings upstream failures", async (fetchImpl) => {
    await expect(runDeployedSmoke(input, deps({ fetch: fetchImpl })))
      .rejects.toMatchObject({ code: "offerings_unavailable", message: "offerings_unavailable" });
  });
});

describe("runDeployedSmokeCli", () => {
  const env = {
    KITH_INN_TRIAL_OPENID: privateOpenid,
    KITH_INN_PROVISIONED_SELLER_ID: "7",
    KITH_INN_BE_SMOKE_URL: "http://127.0.0.1:3310",
    JWT_SECRET: privateJwt,
  };

  it("emits only non-sensitive machine-readable success evidence", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    await expect(runDeployedSmokeCli(env, { stdout, stderr }, deps())).resolves.toBe(0);
    expect(stderr).not.toHaveBeenCalled();
    const output = String(stdout.mock.calls[0]?.[0]);
    expect(JSON.parse(output)).toEqual({ status: "passed", sellerId: "7", offeringCount: 2, ttlSeconds: 60 });
    expect(output).not.toMatch(/private|openid/);
  });

  it("emits a stable category without leaking configuration or upstream errors", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    await expect(runDeployedSmokeCli({}, { stdout, stderr }, deps())).resolves.toBe(1);
    expect(stderr).toHaveBeenLastCalledWith('{"status":"failed","error":"invalid_configuration"}');
    await expect(runDeployedSmokeCli({ ...env, KITH_INN_SMOKE_TTL_SECONDS: "61" }, {
      stdout,
      stderr,
    }, deps())).resolves.toBe(1);
    expect(stderr).toHaveBeenLastCalledWith('{"status":"failed","error":"invalid_configuration"}');
    await expect(runDeployedSmokeCli(env, { stdout, stderr }, deps({
      fetch: vi.fn().mockRejectedValue(new DOMException(privateToken, "TimeoutError")),
    }))).resolves.toBe(1);
    expect(stderr).toHaveBeenLastCalledWith('{"status":"failed","error":"offerings_unavailable"}');
    await expect(runDeployedSmokeCli(env, {
      stdout: () => { throw new Error(privateToken); },
      stderr,
    }, deps())).resolves.toBe(1);
    expect(stderr).toHaveBeenLastCalledWith('{"status":"failed","error":"smoke_failed"}');
    expect(JSON.stringify(stderr.mock.calls)).not.toMatch(/private|openid/);
  });
});
