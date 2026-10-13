import { sql } from "@payloadcms/db-sqlite";
import type { Payload } from "payload";
import type { PrivacyProfile } from "../payload-types";
import { AppError } from "../domain/contracts";

type ProfilePatch = Partial<Pick<PrivacyProfile, "state" | "consent" | "events" | "expiresAt" | "recoveryDigest" | "sensitiveHistory" | "deletedAt">>;

// Payload's update(where) first selects IDs, then updates by ID. Use the
// configured SQLite adapter for a single atomic compare-and-swap instead.
export async function updateProfile(payload: Payload, profile: PrivacyProfile, data: ProfilePatch) {
  if (["deleting", "deleted"].includes(profile.state) && data.state && !["deleting", "deleted"].includes(data.state))
    throw new AppError(409, "删除状态不能恢复为处理状态");
  const columns = { state: "state", consent: "consent", events: "events", expiresAt: "expires_at", recoveryDigest: "recovery_digest", sensitiveHistory: "sensitive_history", deletedAt: "deleted_at" } as const;
  const changes = (Object.keys(columns) as (keyof ProfilePatch)[]).filter((key) => data[key] !== undefined).map((key) => {
    const value = data[key];
    const encoded = value == null ? null : key === "consent" || key === "events" ? JSON.stringify(value) : typeof value === "boolean" ? Number(value) : value;
    return sql`${sql.identifier(columns[key])} = ${encoded}`;
  });
  const updated = await payload.db.drizzle.all(sql`UPDATE privacy_profiles
    SET ${sql.join(changes, sql`, `)}, revision = revision + 1, updated_at = ${new Date().toISOString()}
    WHERE id = ${profile.id} AND owner = ${profile.owner} AND revision = ${profile.revision} AND state = ${profile.state}
    RETURNING id`);
  if (!updated.length) throw new AppError(409, "隐私设置已在其他页面变更，请刷新后重新确认");
}
