import { object, ResponseFormatError } from "../api/contracts";

export interface MembershipStatus {
  babyId: string;
  version: number;
  status: "free" | "scheduled" | "paused" | "expired";
  label: string;
  message: string;
  startsAt: string | null;
  endsAt: string | null;
  entitlements: { chat: boolean; collection: boolean; history: true };
  payment: { enabled: false };
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ResponseFormatError();
  return value;
}
function date(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new ResponseFormatError();
  return result;
}

/** Server decisions are displayed unchanged; dates never grant or deny service here. */
export function decodeMembership(value: unknown, babyId: string): MembershipStatus {
  const row = object(value), entitlements = object(row.entitlements), payment = object(row.payment);
  const status = (["free", "scheduled", "paused", "expired"] as const).find(item => item === row.status);
  if (row.babyId !== babyId || !status || typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 0
    || typeof entitlements.chat !== "boolean" || typeof entitlements.collection !== "boolean" || entitlements.history !== true || payment.enabled !== false) throw new ResponseFormatError();
  return { babyId, version: row.version, status, label: text(row.label), message: text(row.message), startsAt: date(row.startsAt), endsAt: date(row.endsAt),
    entitlements: { chat: entitlements.chat, collection: entitlements.collection, history: true }, payment: { enabled: false } };
}
