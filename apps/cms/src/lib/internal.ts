import configPromise from "@payload-config";
import { sql } from "@payloadcms/db-postgres";
import type { BasePayload, PayloadRequest } from "payload";
import { commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction } from "payload";
import { NextResponse } from "next/server";
import { verifyToken } from "./jwt";

/** The header carrying the operator JWT on every seller-scoped internal call. */
const OPERATOR_JWT_HEADER = "x-kith-inn-operator";

/** A verified operator + the assembled Payload, ready for seller-scoped work. */
type OperatorScope = {
  sellerId: string | number;
  operatorId: string | number;
  payload: BasePayload;
};

/**
 * Verify the operator JWT and resolve the Payload instance. Returns the scope,
 * or a 401/500 NextResponse on bad token / missing secret. Every internal write
 * endpoint starts with this — `sellerId` derives from the verified JWT and is
 * stamped onto writes (overrideAccess), NEVER taken from the request body
 * (seller-token passthrough, no admin key — Tech Spec §3.1).
 */
export async function operatorScope(req: Request): Promise<OperatorScope | NextResponse> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  const jwt = req.headers.get(OPERATOR_JWT_HEADER);
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const decoded = await verifyToken(jwt, jwtSecret);
  if (!decoded) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = await getPayload({ config: configPromise });
  return { sellerId: decoded.sellerId, operatorId: decoded.operatorId, payload };
}

/**
 * Does `id` in `collection` belong to `sellerId`? The internal endpoints write
 * with overrideAccess (no `req.user`), so the §3.1 `assertSameTenantRefs` hook
 * (which fires only on authenticated writes) can't guard cross-tenant refs here.
 * A seller passing another tenant's customer/offering id would otherwise get
 * stored under their sellerId and leak via depth-populated reads. Validate
 * every referenced id against the JWT's sellerId before persisting (Codex P1).
 */
export async function ownedBy(
  payload: BasePayload,
  collection: string,
  id: string | number,
  sellerId: string | number,
  req?: PayloadRequest,
): Promise<boolean> {
  const res = await payload.find({
    collection,
    where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
    limit: 1,
    overrideAccess: true,
    req,
  });
  return res.docs.length > 0;
}

/** Run multiple Payload Local API operations under one shared DB transaction. */
export async function withTransaction<T>(payload: BasePayload, work: (req: PayloadRequest) => Promise<T>): Promise<T> {
  const req = await createLocalReq({}, payload);
  const started = await initTransaction(req);
  if (!started) throw new Error("database transactions unavailable");
  try {
    const result = await work(req);
    await commitTransaction(req);
    return result;
  } catch (error) {
    await killTransaction(req);
    throw error;
  }
}

/**
 * Serialize reconciliation against every regular order/fulfillment writer.
 * Every application writer must acquire this lock before its first read so it
 * cannot resume from a stale decision after reconciliation commits. SQLite
 * already starts write transactions with `BEGIN IMMEDIATE` and needs no extra
 * lock.
 */
export async function lockOrderReconciliationWrites(
  payload: BasePayload,
  req: PayloadRequest,
): Promise<void> {
  if (payload.db.name !== "postgres") return;
  const transactionId = await req.transactionID;
  const transaction = transactionId == null ? undefined : payload.db.sessions?.[String(transactionId)]?.db;
  if (!transaction) throw new Error("database transaction session unavailable");

  const db = payload.db as BasePayload["db"] & {
    execute(args: { db: unknown; sql: ReturnType<typeof sql> }): Promise<unknown>;
  };
  // ponytail: this global lock is intentionally coarse for a single-seller MVP;
  // move every writer to per-scope locks only when reconciliation throughput demands it.
  await db.execute({
    db: transaction,
    sql: sql`LOCK TABLE "cms"."fulfillments", "cms"."orders", "cms"."order_items" IN SHARE ROW EXCLUSIVE MODE`,
  });
}
