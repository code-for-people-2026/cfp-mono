type Env = Record<string, string | undefined>;

/** Local development keeps schema push; production and migration verification never do. */
export function databasePushEnabled(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" && env.PAYLOAD_DB_PUSH !== "false";
}

/** Fail closed when the database history is behind or ahead of the committed files. */
export type AppliedMigration = { name: string; batch: number };

/** A committed prefix is safe to advance; dev-push and foreign files are not. */
export function assertMigrationHistorySafe(applied: AppliedMigration[], expected: string[]): void {
  const names = applied.map(({ name }) => name);
  if (
    applied.some(({ batch }) => batch < 1) ||
    names.some((name, index) => name !== expected[index]) ||
    new Set(names).size !== names.length
  ) {
    throw new Error("unsafe migration history");
  }
}

export function assertMigrationHead(applied: AppliedMigration[], expected: string[]): void {
  const appliedNames = applied.map(({ name }) => name);
  if (
    applied.some(({ batch }) => batch < 1) ||
    appliedNames.length !== expected.length ||
    appliedNames.some((name, index) => name !== expected[index])
  ) {
    throw new Error("cms migration head mismatch");
  }
}
