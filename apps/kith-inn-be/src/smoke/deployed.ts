import type { OperatorRecord } from "../lib/cms/client";

export type DeployedSmokeCode =
  | "invalid_configuration"
  | "operator_lookup_failed"
  | "operator_not_provisioned"
  | "seller_mismatch"
  | "token_issue_failed"
  | "offerings_unavailable";

export type DeployedSmokeInput = {
  openid: string;
  provisionedSellerId: string;
  jwtSecret: string;
  beBaseUrl: string;
  ttlSeconds: number;
};

export type DeployedSmokeDeps = {
  findOperatorByOpenid: (openid: string, signal: AbortSignal) => Promise<OperatorRecord | null>;
  issueToken: (
    payload: Pick<OperatorRecord, "sellerId" | "role"> & { operatorId: OperatorRecord["id"] },
    secret: string,
    ttlSeconds: number,
  ) => Promise<string>;
  fetch: typeof fetch;
  timeoutSignal: (milliseconds: number) => AbortSignal;
};

export type DeployedSmokeIo = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

export type DeployedSmokeEnv = Record<string, string | undefined>;

class DeployedSmokeError extends Error {
  constructor(readonly code: DeployedSmokeCode) {
    super(code);
  }
}

function failure(code: DeployedSmokeCode): DeployedSmokeError {
  return new DeployedSmokeError(code);
}

function required(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw failure("invalid_configuration");
  return normalized;
}

function loopbackOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(required(value));
  } catch {
    throw failure("invalid_configuration");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    Boolean(url.username || url.password) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw failure("invalid_configuration");
  }
  return url.origin;
}

/** One-shot deployed smoke: resolve the provisioned operator, mint a short JWT, and perform one read. */
export async function runDeployedSmoke(
  input: DeployedSmokeInput,
  deps: DeployedSmokeDeps,
) {
  const openid = required(input.openid);
  const provisionedSellerId = required(input.provisionedSellerId);
  const jwtSecret = required(input.jwtSecret);
  const beBaseUrl = loopbackOrigin(input.beBaseUrl);
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > 60) {
    throw failure("invalid_configuration");
  }

  let operator: OperatorRecord | null;
  try {
    operator = await deps.findOperatorByOpenid(openid, deps.timeoutSignal(5_000));
  } catch {
    throw failure("operator_lookup_failed");
  }
  if (!operator?.active) throw failure("operator_not_provisioned");
  if (String(operator.sellerId) !== provisionedSellerId) throw failure("seller_mismatch");

  let token: string | undefined;
  try {
    try {
      token = await deps.issueToken({
        operatorId: operator.id,
        sellerId: operator.sellerId,
        role: operator.role,
      }, jwtSecret, input.ttlSeconds);
    } catch {
      throw failure("token_issue_failed");
    }

    let response: Response;
    try {
      response = await deps.fetch(`${beBaseUrl}/offerings`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: deps.timeoutSignal(5_000),
      });
    } catch {
      throw failure("offerings_unavailable");
    }
    if (!response.ok) throw failure("offerings_unavailable");

    try {
      const body = (await response.json()) as { offerings?: unknown };
      if (!Array.isArray(body.offerings)) throw failure("offerings_unavailable");
      return {
        status: "passed" as const,
        sellerId: String(operator.sellerId),
        offeringCount: body.offerings.length,
        ttlSeconds: input.ttlSeconds,
      };
    } catch {
      throw failure("offerings_unavailable");
    }
  } finally {
    token = undefined;
  }
}

/** Parse the process env and emit only stable machine-readable, non-sensitive evidence. */
export async function runDeployedSmokeCli(
  env: DeployedSmokeEnv,
  io: DeployedSmokeIo,
  deps: DeployedSmokeDeps,
): Promise<number> {
  try {
    const result = await runDeployedSmoke({
      openid: env.KITH_INN_TRIAL_OPENID ?? "",
      provisionedSellerId: env.KITH_INN_PROVISIONED_SELLER_ID ?? "",
      jwtSecret: env.JWT_SECRET ?? "",
      beBaseUrl: env.KITH_INN_BE_SMOKE_URL ?? "",
      ttlSeconds: env.KITH_INN_SMOKE_TTL_SECONDS === undefined
        ? 60
        : Number(env.KITH_INN_SMOKE_TTL_SECONDS),
    }, deps);
    io.stdout(JSON.stringify(result));
    return 0;
  } catch (error) {
    const code = error instanceof DeployedSmokeError ? error.code : "smoke_failed";
    io.stderr(JSON.stringify({ status: "failed", error: code }));
    return 1;
  }
}
