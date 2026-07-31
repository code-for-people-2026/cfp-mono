import { describe, expect, it } from "vitest";
import { resolveWeeklyMenuDatabaseUrl } from "./database";

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
});
