import { getPayload, type Payload } from "payload";
import config from "../../payload.config";
import { assertDevResetAllowed, configuredPostgresUrl } from "../../seed/run";
import { resetSeedData } from "@cfp/kith-inn-payload/seed";

export const MAINLINE_JWT_SECRET = "kith-inn-mainline-postgres-secret";
export const hasMainlinePostgres = Boolean(configuredPostgresUrl());

type Id = string | number;

export type MainlineTenant = {
  sellerId: Id;
  operatorId: Id;
  componentId: Id;
  comboId: Id;
  token: string;
};

const b64url = (value: string | Uint8Array): string => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function issueToken(operatorId: Id, sellerId: Id): Promise<string> {
  const encoder = new TextEncoder();
  const data = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({ operatorId, sellerId, role: "owner" }))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(MAINLINE_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `${data}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))))}`;
}

async function createTenant(payload: Payload, label: string): Promise<MainlineTenant> {
  const suffix = crypto.randomUUID();
  const seller = await payload.create({
    collection: "sellers",
    data: { name: `${label}-${suffix}`, status: "active", defaultPriceCents: 3000 },
    overrideAccess: true,
  });
  const operator = await payload.create({
    collection: "operators",
    data: {
      seller: seller.id,
      email: `${suffix}@mainline.test`,
      password: `${suffix}-password`,
      wechatOpenid: `mainline-${suffix}`,
      role: "owner",
      active: true,
    },
    overrideAccess: true,
  });
  const component = await payload.create({
    collection: "offerings",
    data: { seller: seller.id, name: `${label}菜`, kind: "component", category: "meat", active: true },
    overrideAccess: true,
  });
  const combo = await payload.create({
    collection: "offerings",
    data: { seller: seller.id, name: `${label}套餐`, kind: "combo-meal", priceCents: 3000, active: true },
    overrideAccess: true,
  });
  return {
    sellerId: seller.id,
    operatorId: operator.id,
    componentId: component.id,
    comboId: combo.id,
    token: await issueToken(operator.id, seller.id),
  };
}

export async function startKithInnMainline(): Promise<{
  payload: Payload;
  sellerA: MainlineTenant;
  sellerB: MainlineTenant;
}> {
  if (!hasMainlinePostgres) throw new Error("kith-inn mainline integration requires PostgreSQL");
  assertDevResetAllowed();
  const originalJwtSecret = process.env.JWT_SECRET;
  let payload: Payload | undefined;
  try {
    process.env.JWT_SECRET = MAINLINE_JWT_SECRET;
    payload = await getPayload({ config });
    await resetSeedData(payload as Parameters<typeof resetSeedData>[0]);
    return {
      payload,
      sellerA: await createTenant(payload, "seller-a"),
      sellerB: await createTenant(payload, "seller-b"),
    };
  } catch (error) {
    if (payload) {
      await resetSeedData(payload as Parameters<typeof resetSeedData>[0]).catch(() => undefined);
      await payload.destroy().catch(() => undefined);
    }
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    throw error;
  }
}

export function routeRequest(token: string, path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://cms.test/api/internal${path}`, {
    method,
    headers: {
      "x-kith-inn-operator": token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
