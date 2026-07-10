import { z } from "zod";
import { relationshipIdSchema } from "./schemas";

export const SELECTION_TOKEN_TTL_SECONDS = 5 * 60;
export const OPERATOR_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export const operatorSelectionChoiceSchema = z.object({
  operatorId: relationshipIdSchema,
  sellerId: relationshipIdSchema
}).strict();

const timestamps = {
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive()
};

export const operatorSelectionClaimsSchema = z.object({
  kind: z.literal("operator-selection"),
  choices: z.array(operatorSelectionChoiceSchema).min(2),
  ...timestamps
}).strict().refine(({ exp, iat }) => exp > iat, { message: "exp 必须晚于 iat" });

export const operatorClaimsSchema = z.object({
  kind: z.literal("operator"),
  operatorId: relationshipIdSchema,
  sellerId: relationshipIdSchema,
  role: z.literal("operator"),
  ...timestamps
}).strict().refine(({ exp, iat }) => exp > iat, { message: "exp 必须晚于 iat" });

export type OperatorSelectionChoice = z.infer<typeof operatorSelectionChoiceSchema>;
export type OperatorSelectionClaims = z.infer<typeof operatorSelectionClaimsSchema>;
export type OperatorClaims = z.infer<typeof operatorClaimsSchema>;

const headerSchema = z.object({ alg: z.literal("HS256"), typ: z.literal("JWT") }).strict();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(encoder.encode(JSON.stringify(value)));
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson(value: string): unknown {
  return JSON.parse(decoder.decode(decodeBase64Url(value))) as unknown;
}

async function keyFor(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage
  );
}

async function issue(claims: unknown, secret: string): Promise<string> {
  if (!secret) throw new Error("JWT secret is required");
  const unsigned = `${encodeJson({ alg: "HS256", typ: "JWT" })}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign("HMAC", await keyFor(secret, ["sign"]), encoder.encode(unsigned));
  return `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function verify<T>(
  token: string,
  secret: string,
  schema: z.ZodType<T>,
  nowSeconds: number
): Promise<T | null> {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const [header, payload, signature] = parts as [string, string, string];
    if (!headerSchema.safeParse(decodeJson(header)).success) return null;
    const unsigned = `${header}.${payload}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await keyFor(secret, ["verify"]),
      decodeBase64Url(signature) as BufferSource,
      encoder.encode(unsigned)
    );
    if (!valid) return null;
    const parsed = schema.safeParse(decodeJson(payload));
    if (!parsed.success || nowSeconds >= (parsed.data as { exp: number }).exp) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

const now = (): number => Math.floor(Date.now() / 1000);

export async function issueOperatorSelectionToken(
  choices: OperatorSelectionChoice[],
  secret: string,
  nowSeconds = now()
): Promise<string> {
  const claims = operatorSelectionClaimsSchema.parse({
    kind: "operator-selection",
    choices,
    iat: nowSeconds,
    exp: nowSeconds + SELECTION_TOKEN_TTL_SECONDS
  });
  return issue(claims, secret);
}

export async function issueOperatorToken(
  ids: Pick<OperatorClaims, "operatorId" | "sellerId">,
  secret: string,
  nowSeconds = now()
): Promise<string> {
  const claims = operatorClaimsSchema.parse({
    kind: "operator",
    ...ids,
    role: "operator",
    iat: nowSeconds,
    exp: nowSeconds + OPERATOR_TOKEN_TTL_SECONDS
  });
  return issue(claims, secret);
}

export function verifyOperatorSelectionToken(
  token: string,
  secret: string,
  nowSeconds = now()
): Promise<OperatorSelectionClaims | null> {
  return verify(token, secret, operatorSelectionClaimsSchema, nowSeconds);
}

export function verifyOperatorToken(
  token: string,
  secret: string,
  nowSeconds = now()
): Promise<OperatorClaims | null> {
  return verify(token, secret, operatorClaimsSchema, nowSeconds);
}
