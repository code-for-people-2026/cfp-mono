import { describe, expect, it } from "vitest";
import { createWeeklyMenuPool, resolveWeeklyMenuDatabaseUrl } from "./database";

describe("resolveWeeklyMenuDatabaseUrl", () => {
  it("only accepts the dedicated PostgreSQL variable", () => {
    expect(
      resolveWeeklyMenuDatabaseUrl({
        WEEKLY_MENU_DATABASE_URL: "postgresql://weekly@example.test/weekly_menu",
        DATABASE_URL: "postgresql://website@example.test/website"
      })
    ).toBe("postgresql://weekly@example.test/weekly_menu");
    expect(() =>
      resolveWeeklyMenuDatabaseUrl({
        DATABASE_URL: "postgresql://website@example.test/website"
      })
    ).toThrow("WEEKLY_MENU_DATABASE_URL is required");
  });

  it.each(["https://example.test/db", "postgres://", "postgresql://host/"])(
    "rejects a non-database URL: %s",
    (value) => {
      expect(() =>
        resolveWeeklyMenuDatabaseUrl({ WEEKLY_MENU_DATABASE_URL: value })
      ).toThrow("WEEKLY_MENU_DATABASE_URL must be a PostgreSQL database URL");
    }
  );

  it("passes finite connection and server statement timeouts to PostgreSQL", async () => {
    const pool = createWeeklyMenuPool(
      { WEEKLY_MENU_DATABASE_URL: "postgresql://weekly@example.test/weekly_menu" },
      { connectionTimeoutMillis: 2_000, statement_timeout: 2_000 }
    );
    expect(pool.options).toMatchObject({
      connectionTimeoutMillis: 2_000,
      statement_timeout: 2_000
    });
    await pool.end();
  });
});
