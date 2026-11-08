import { ResponseFormatError } from "./contracts";

/**
 * Narrow reader for the existing GET /api/app/audits contract.
 *
 * The audit endpoint is scoped by the authorized baby and only exposes an account
 * id, an input method and optional original text. It cannot tell us a human name or
 * whether the text/voice capture happened in the app or a WeChat group.
 */
export const AUDIT_PAGE_SIZE = 200;
/** The legacy endpoint clamps offset to 5,000; never ask beyond that range. */
export const AUDIT_MAX_OFFSET = 5000;
export const AUDIT_INPUT_METHODS = ["TEXT", "VOICE"] as const;
export type AuditInputMethod = (typeof AUDIT_INPUT_METHODS)[number];
export type AuditAction = "CREATE" | "UPDATE" | "DELETE";

export interface AuditLogRecord {
  id: string;
  action: AuditAction;
  resourceType: "ACTIVITY";
  success: boolean;
  inputMethod: AuditInputMethod;
  resourceId?: string | null;
  activityId?: string | null;
  babyId?: string | null;
  userId?: string | null;
  inputText?: string | null;
  createdAt?: string | null;
}

export interface AuditPage {
  data: AuditLogRecord[];
  total: number;
  hasMore: boolean;
}

/** Small read model of existing audit fields. No Activity fields are invented. */
export interface ActivityProvenance {
  accountId: string | null;
  inputMethod: AuditInputMethod | null;
  inputText: string | null;
  addedAt: string | null;
}

export interface ActivityProvenanceResult {
  provenance: ActivityProvenance | null;
  /** False means the bounded scan stopped early; absence cannot be claimed. */
  complete: boolean;
  pages: number;
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResponseFormatError();
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
  if (typeof value !== "string") throw new ResponseFormatError();
  return value;
};
const identifier = (value: unknown): string => {
  const result = text(value);
  if (!result.trim()) throw new ResponseFormatError();
  return result;
};
const optionalIdentifier = (value: unknown): string | null | undefined =>
  value === undefined || value === null ? value : identifier(value);
const optionalText = (value: unknown): string | null | undefined =>
  value === undefined || value === null ? value : text(value);
const optionalDate = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null) return value;
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new ResponseFormatError();
  return result;
};
const boolean = (value: unknown): boolean => {
  if (typeof value !== "boolean") throw new ResponseFormatError();
  return value;
};
const numeric = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new ResponseFormatError();
  return value;
};
const choice = <T extends string>(value: unknown, allowed: readonly T[]): T => {
  const found = allowed.find((item) => item === value);
  if (found === undefined) throw new ResponseFormatError();
  return found;
};

function auditLog(value: unknown): AuditLogRecord {
  const row = record(value);
  const resourceType = choice(row.resourceType, ["ACTIVITY"] as const);
  const result: AuditLogRecord = {
    id: identifier(row.id),
    action: choice(row.action, ["CREATE", "UPDATE", "DELETE"] as const),
    resourceType,
    success: boolean(row.success),
    inputMethod: choice(row.inputMethod, AUDIT_INPUT_METHODS),
  };
  const resourceId = optionalIdentifier(row.resourceId);
  const activityId = optionalIdentifier(row.activityId);
  const babyId = optionalIdentifier(row.babyId);
  const userId = optionalIdentifier(row.userId);
  const inputText = optionalText(row.inputText);
  const createdAt = optionalDate(row.createdAt);
  if (resourceId !== undefined) result.resourceId = resourceId;
  if (activityId !== undefined) result.activityId = activityId;
  if (babyId !== undefined) result.babyId = babyId;
  if (userId !== undefined) result.userId = userId;
  if (inputText !== undefined) result.inputText = inputText;
  if (createdAt !== undefined) result.createdAt = createdAt;
  // beforeData/afterData/errorMessage are deliberately not decoded or stored.
  return result;
}

export function auditPage(value: unknown): AuditPage {
  const row = record(value);
  if (!Array.isArray(row.data)) throw new ResponseFormatError();
  return {
    data: row.data.map(auditLog),
    total: numeric(row.total),
    hasMore: boolean(row.hasMore),
  };
}

export interface ActivityProvenanceSelection {
  provenance: ActivityProvenance | null;
  /** A row that looked relevant disagreed with the requested scope or itself. */
  conflict: boolean;
}

/**
 * Find a successful CREATE for exactly this activity. resourceId and activityId
 * are both accepted when they agree; the audit must also carry the exact requested
 * babyId, because a missing or foreign scope is not evidence for this family.
 * UPDATE, failed CREATE, unrelated and cross-baby rows are never returned.
 */
export function selectActivityProvenance(
  rows: readonly AuditLogRecord[],
  babyId: string,
  activityId: string,
): ActivityProvenanceSelection {
  let found: ActivityProvenance | null = null;
  let conflict = false;
  for (const row of rows) {
    if (row.action !== "CREATE" || !row.success) continue;
    const resource = row.resourceId ?? null;
    const linked = row.activityId ?? null;
    if (resource === null && linked === null) continue;
    const matches = resource === activityId || linked === activityId;
    if (!matches) continue;
    // If both ids are present and disagree, this row cannot be trusted as either id.
    if (resource !== null && linked !== null && resource !== linked) {
      conflict = true;
      continue;
    }
    if (row.babyId !== babyId) {
      conflict = true;
      continue;
    }
    if (!found) {
      found = {
        accountId: row.userId ?? null,
        inputMethod: row.inputMethod,
        inputText: row.inputText ?? null,
        addedAt: row.createdAt ?? null,
      };
    }
  }
  return { provenance: conflict ? null : found, conflict };
}
