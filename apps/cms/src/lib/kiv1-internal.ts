import { verifyCustomerToken, verifyOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import configPromise from "@payload-config";
import { sql } from "@payloadcms/db-postgres";
import {
  commitTransaction,
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
  type BasePayload,
  type PayloadRequest
} from "payload";
import { NextResponse } from "next/server";

const KIV1_INTERNAL_HEADER = "x-kith-inn-v1-internal";
const KIV1_OPERATOR_HEADER = "x-kith-inn-v1-operator";
const KIV1_CUSTOMER_HEADER = "x-kith-inn-v1-customer";

type Kiv1OperatorScope = {
  operatorId: string | number;
  sellerId: string | number;
  token: string;
  payload: BasePayload;
};

type Kiv1CustomerScope = {
  sellerId: string | number;
  openid: string;
  token: string;
  payload: BasePayload;
};

export function requireServiceAuth(req: Request): NextResponse | null {
  const expected = process.env.KITH_INN_V1_INTERNAL_TOKEN;
  if (!expected) return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  if (req.headers.get(KIV1_INTERNAL_HEADER) !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function servicePayload(req: Request): Promise<BasePayload | NextResponse> {
  const authError = requireServiceAuth(req);
  if (authError) return authError;
  return getPayload({ config: configPromise });
}

export async function operatorScope(req: Request): Promise<Kiv1OperatorScope | NextResponse> {
  const secret = process.env.KITH_INN_V1_JWT_SECRET;
  if (!secret) return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  const token = req.headers.get(KIV1_OPERATOR_HEADER);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const claims = await verifyOperatorToken(token, secret);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = await getPayload({ config: configPromise });
  const memberships = await payload.find({
    collection: "kiv1_operators",
    where: { and: [
      { id: { equals: claims.operatorId } },
      { seller: { equals: claims.sellerId } },
      { active: { equals: true } }
    ] },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  if (memberships.docs.length === 0) {
    return NextResponse.json({ error: "membership-inactive" }, { status: 403 });
  }
  const sellers = await payload.find({
    collection: "kiv1_sellers",
    where: { and: [
      { id: { equals: claims.sellerId } },
      { status: { equals: "active" } }
    ] },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  if (sellers.docs.length === 0) {
    return NextResponse.json({ error: "seller-inactive" }, { status: 403 });
  }
  return {
    operatorId: claims.operatorId,
    sellerId: claims.sellerId,
    token,
    payload
  };
}

export async function customerScope(req: Request): Promise<Kiv1CustomerScope | NextResponse> {
  const secret = process.env.KITH_INN_V1_JWT_SECRET;
  if (!secret) return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  const token = req.headers.get(KIV1_CUSTOMER_HEADER);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const claims = await verifyCustomerToken(token, secret);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = await getPayload({ config: configPromise });
  const sellers = await payload.find({
    collection: "kiv1_sellers",
    where: { and: [
      { id: { equals: claims.sellerId } },
      { status: { equals: "active" } }
    ] },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  if (sellers.docs.length === 0) {
    return NextResponse.json({ error: "seller-inactive" }, { status: 403 });
  }
  return { sellerId: claims.sellerId, openid: claims.openid, token, payload };
}

export async function customerWriteScope(req: Request): Promise<Kiv1CustomerScope | NextResponse> {
  const authError = requireServiceAuth(req);
  if (authError) return authError;
  return customerScope(req);
}

/** Lock one v1 order so the customer status check and write cannot race a merchant update. */
export async function withCustomerOrderLock<T>(
  payload: BasePayload,
  id: string | number,
  work: (req: PayloadRequest) => Promise<T>
): Promise<T> {
  const req = await createLocalReq({}, payload);
  const started = await initTransaction(req);
  if (!started) throw new Error("database transactions unavailable");
  try {
    if (payload.db.name === "postgres") {
      const transactionId = await req.transactionID;
      const transaction = transactionId == null ? undefined : payload.db.sessions?.[String(transactionId)]?.db;
      if (!transaction) throw new Error("database transaction session unavailable");
      const database = payload.db as BasePayload["db"] & {
        execute(args: { db: unknown; sql: ReturnType<typeof sql> }): Promise<unknown>;
      };
      await database.execute({
        db: transaction,
        sql: sql`SELECT "id" FROM "cms"."kiv1_orders" WHERE "id" = ${id} FOR UPDATE`
      });
    }
    const result = await work(req);
    await commitTransaction(req);
    return result;
  } catch (error) {
    await killTransaction(req);
    throw error;
  }
}

export function hasSellerField(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.hasOwn(value, "seller");
}

export async function findOwned(
  payload: Pick<BasePayload, "find">,
  collection: string,
  id: string | number,
  sellerId: string | number
): Promise<unknown | undefined> {
  const result = await payload.find({
    collection,
    where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  return result.docs[0];
}

export function isUniqueConflict(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  if (status === 409) return true;
  const seen = new Set<object>();
  const pending: unknown[] = [error];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string" && /unique|duplicate|already exists|23505|sqlite_constraint_unique/i.test(value)) {
      return true;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) continue;
    seen.add(value);
    for (const key of Object.getOwnPropertyNames(value)) pending.push((value as Record<string, unknown>)[key]);
  }
  return false;
}
