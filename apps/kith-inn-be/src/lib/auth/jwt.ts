/**
 * HS256 JWT issue/verify via Web Crypto (Node's global `crypto.subtle`).
 *
 * kith-inn-be issues its own operator JWT after wx-login (the FE holds it; the BE
 * forwards it to cms as `x-kith-inn-operator`). Pure + synchronous-ish (async only
 * for crypto), so directly unit-testable with a known secret.
 */

export type OperatorJwt = {
  operatorId: string | number;
  sellerId: string | number;
  role: string;
  exp?: number; // seconds since epoch
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlString(s: string): string {
  return b64urlBytes(encoder.encode(s));
}

function b64urlDecodeToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueToken(
  payload: Omit<OperatorJwt, "exp">,
  secret: string,
  ttlSeconds: number | null = 7 * 24 * 60 * 60,
): Promise<string> {
  // ttlSeconds === null → no exp (token never expires); used by tests + future
  // long-lived service tokens. Default 7 days for operator sessions.
  const now = Math.floor(Date.now() / 1000);
  const body: OperatorJwt =
    ttlSeconds === null ? { ...payload } : { ...payload, exp: now + ttlSeconds };
  const data = `${b64urlString(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64urlString(JSON.stringify(body))}`;
  const key = await hmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
  return `${data}.${b64urlBytes(signature)}`;
}

export async function verifyToken(token: string, secret: string): Promise<OperatorJwt | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const data = `${header}.${payload}`;
  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecodeToBytes(signature) as BufferSource,
      encoder.encode(data),
    );
    if (!valid) return null;
    const decoded = JSON.parse(decoder.decode(b64urlDecodeToBytes(payload))) as OperatorJwt;
    if (decoded.exp !== undefined && decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    // Malformed token (bad base64 segment, non-JSON payload, etc.) → deny.
    return null;
  }
}
