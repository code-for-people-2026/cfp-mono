// JWT verify for cms internal endpoints — verifies operator JWTs issued by
// kith-inn-be. HS256 via Web Crypto, shared JWT_SECRET. Duplicated from
// apps/kith-inn-be/src/lib/auth/jwt.ts (verify-only); share via a package when
// a third consumer appears.

type OperatorJwt = {
  operatorId: string | number;
  sellerId: string | number;
  role: string;
  exp?: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlDecodeToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
}

export async function verifyToken(token: string, secret: string): Promise<OperatorJwt | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const data = `${header}.${payload}`;
  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify("HMAC", key, b64urlDecodeToBytes(signature) as BufferSource, encoder.encode(data));
    if (!valid) return null;
    const decoded = JSON.parse(decoder.decode(b64urlDecodeToBytes(payload))) as OperatorJwt;
    if (decoded.exp !== undefined && decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}
