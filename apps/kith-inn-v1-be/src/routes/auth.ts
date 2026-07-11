import {
  CUSTOMER_TOKEN_TTL_SECONDS,
  OPERATOR_TOKEN_TTL_SECONDS,
  issueCustomerToken,
  issueOperatorSelectionToken,
  issueOperatorToken,
  verifyOperatorSelectionToken
} from "@cfp/kith-inn-v1-shared/auth";
import {
  customerDevSessionInputSchema,
  customerWxSessionInputSchema
} from "@cfp/kith-inn-v1-shared/api";
import type { CustomerSessionBootstrapResponse } from "@cfp/kith-inn-v1-shared";
import { Hono, type Context } from "hono";
import {
  findOperatorMemberships as findOperatorMembershipsFn,
  findCustomerSessionBootstrap as findCustomerSessionBootstrapFn,
  CmsAuthError,
  type MembershipLookup,
  type OperatorMembership
} from "../lib/cms/auth";
import { Code2SessionError, code2session as code2sessionFn } from "../lib/wx/code2session";

export type AuthDeps = {
  code2session: (code: string) => Promise<string>;
  findOperatorMemberships: (lookup: MembershipLookup) => Promise<OperatorMembership[]>;
  now: () => number;
};

export type CustomerAuthDeps = {
  code2session: (code: string) => Promise<string>;
  findCustomerSessionBootstrap: (batchPublicId: string) => Promise<CustomerSessionBootstrapResponse>;
  now: () => number;
};

const defaultDeps: AuthDeps = {
  code2session: code2sessionFn,
  findOperatorMemberships: findOperatorMembershipsFn,
  now: () => Math.floor(Date.now() / 1000)
};

const defaultCustomerDeps: CustomerAuthDeps = {
  code2session: code2sessionFn,
  findCustomerSessionBootstrap: findCustomerSessionBootstrapFn,
  now: () => Math.floor(Date.now() / 1000)
};

function validId(value: unknown): value is string | number {
  return (typeof value === "string" && value !== "") || (typeof value === "number" && Number.isInteger(value));
}

function strictObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

async function json(req: { json: () => Promise<unknown> }): Promise<unknown> {
  return req.json().catch(() => null);
}

function sameId(left: string | number, right: string | number): boolean {
  return String(left) === String(right);
}

async function authenticated(membership: OperatorMembership, secret: string, now: number) {
  const token = await issueOperatorToken({
    operatorId: membership.operatorId,
    sellerId: membership.sellerId
  }, secret, now);
  return {
    status: "authenticated" as const,
    token,
    session: {
      operatorId: membership.operatorId,
      sellerId: membership.sellerId,
      sellerName: membership.sellerName,
      role: "operator" as const,
      expiresAt: new Date((now + OPERATOR_TOKEN_TTL_SECONDS) * 1000).toISOString()
    }
  };
}

async function loginResult(memberships: OperatorMembership[], secret: string, now: number) {
  if (memberships.length === 0) return null;
  if (memberships.length === 1) return authenticated(memberships[0]!, secret, now);
  return {
    status: "seller-selection-required" as const,
    selectionToken: await issueOperatorSelectionToken(
      memberships.map(({ operatorId, sellerId }) => ({ operatorId, sellerId })),
      secret,
      now
    ),
    sellers: memberships.map(({ sellerId, sellerName }) => ({ sellerId, sellerName }))
  };
}

export function authRoutes(secret: string, deps: AuthDeps = defaultDeps) {
  const app = new Hono();

  app.post("/wx-login", async (c) => {
    const body = await json(c.req);
    if (!strictObject(body, ["code"]) || typeof body.code !== "string" || body.code === "") {
      return c.json({ error: "invalid-login-input", message: "微信登录参数无效" }, 422);
    }
    try {
      const openid = await deps.code2session(body.code);
      const result = await loginResult(await deps.findOperatorMemberships({ openid }), secret, deps.now());
      return result
        ? c.json(result)
        : c.json({ error: "operator-not-provisioned", message: "该微信尚未绑定商家" }, 401);
    } catch {
      return c.json({ error: "wechat-login-failed", message: "微信身份识别失败" }, 502);
    }
  });

  app.post("/dev-login", async (c) => {
    if (process.env.NODE_ENV === "production" || process.env.KITH_INN_V1_ALLOW_DEV_LOGIN !== "1") {
      return c.json({ error: "not-found", message: "接口不存在" }, 404);
    }
    const body = await json(c.req);
    if (!strictObject(body, ["openid"]) || typeof body.openid !== "string" || body.openid === "") {
      return c.json({ error: "invalid-login-input", message: "开发身份参数无效" }, 422);
    }
    try {
      const result = await loginResult(await deps.findOperatorMemberships({ openid: body.openid }), secret, deps.now());
      return result
        ? c.json(result)
        : c.json({ error: "operator-not-provisioned", message: "该身份尚未绑定商家" }, 401);
    } catch {
      return c.json({ error: "cms-unavailable", message: "商家身份服务暂不可用" }, 502);
    }
  });

  app.post("/select-seller", async (c) => {
    const body = await json(c.req);
    if (!strictObject(body, ["selectionToken", "sellerId"]) ||
      typeof body.selectionToken !== "string" || !validId(body.sellerId)) {
      return c.json({ error: "invalid-selection-input", message: "商家选择参数无效" }, 422);
    }
    const claims = await verifyOperatorSelectionToken(body.selectionToken, secret, deps.now());
    const choice = claims?.choices.find(({ sellerId }) => sameId(sellerId, body.sellerId as string | number));
    if (!choice) return c.json({ error: "invalid-seller-selection", message: "商家选择已失效" }, 401);
    try {
      const current = await deps.findOperatorMemberships({ operatorId: choice.operatorId });
      const membership = current.find(({ operatorId, sellerId }) =>
        sameId(operatorId, choice.operatorId) && sameId(sellerId, choice.sellerId)
      );
      return membership
        ? c.json(await authenticated(membership, secret, deps.now()))
        : c.json({ error: "membership-inactive", message: "商家身份已停用" }, 403);
    } catch {
      return c.json({ error: "cms-unavailable", message: "商家身份服务暂不可用" }, 502);
    }
  });

  return app;
}

async function customerSession(
  bootstrap: CustomerSessionBootstrapResponse,
  openid: string,
  secret: string,
  now: number
) {
  return {
    token: await issueCustomerToken({ sellerId: bootstrap.seller.id, openid }, secret, now),
    session: {
      sellerName: bootstrap.seller.name,
      role: "customer" as const,
      expiresAt: new Date((now + CUSTOMER_TOKEN_TTL_SECONDS) * 1000).toISOString()
    }
  };
}

function customerBootstrapError(c: Context, error: unknown) {
  if (error instanceof CmsAuthError && error.status === 404) {
    return c.json({ error: "booking-batch-not-found", message: "预订入口不存在" }, 404);
  }
  if (error instanceof CmsAuthError && error.status === 403) {
    return c.json({ error: "seller-inactive", message: "商家暂不可用" }, 403);
  }
  return c.json({ error: "cms-unavailable", message: "预订入口服务暂不可用" }, 502);
}

export function customerAuthRoutes(secret: string, deps: CustomerAuthDeps = defaultCustomerDeps) {
  const app = new Hono();

  app.post("/wx-session", async (c) => {
    const parsed = customerWxSessionInputSchema.safeParse(await json(c.req));
    if (!parsed.success) return c.json({ error: "invalid-login-input", message: "微信登录参数无效" }, 422);
    let bootstrap: CustomerSessionBootstrapResponse;
    try {
      bootstrap = await deps.findCustomerSessionBootstrap(parsed.data.batchPublicId);
    } catch (error) {
      return customerBootstrapError(c, error);
    }
    try {
      const openid = await deps.code2session(parsed.data.code);
      return c.json(await customerSession(bootstrap, openid, secret, deps.now()));
    } catch (error) {
      return error instanceof Code2SessionError && error.kind === "invalid"
        ? c.json({ error: "invalid-wechat-code", message: "微信登录凭证无效" }, 401)
        : c.json({ error: "wechat-unavailable", message: "微信身份服务暂不可用" }, 502);
    }
  });

  app.post("/dev-session", async (c) => {
    if (process.env.NODE_ENV === "production" || process.env.KITH_INN_V1_ALLOW_DEV_LOGIN !== "1") {
      return c.json({ error: "not-found", message: "接口不存在" }, 404);
    }
    const parsed = customerDevSessionInputSchema.safeParse(await json(c.req));
    if (!parsed.success) return c.json({ error: "invalid-login-input", message: "开发身份参数无效" }, 422);
    try {
      const bootstrap = await deps.findCustomerSessionBootstrap(parsed.data.batchPublicId);
      return c.json(await customerSession(bootstrap, parsed.data.openid, secret, deps.now()));
    } catch (error) {
      return customerBootstrapError(c, error);
    }
  });

  return app;
}
