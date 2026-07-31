export function resolveWeeklyMenuDatabaseUrl(environment = process.env) {
  const value = environment.WEEKLY_MENU_DATABASE_URL?.trim();
  if (!value) throw new Error("WEEKLY_MENU_DATABASE_URL is required");

  const parsed = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname === "/"
  ) {
    throw new Error("WEEKLY_MENU_DATABASE_URL must be a PostgreSQL database URL");
  }

  return value;
}
