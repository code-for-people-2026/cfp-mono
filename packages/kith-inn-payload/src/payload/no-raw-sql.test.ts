import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * §3.1 read-side isolation forbids raw SQL: tenant-scoped reads must go through
 * the Payload API (which honors access control + parameterizes). This asserts
 * the package ships NO `sql` tagged-template / `db.execute` raw-SQL at all — any
 * SQL lives in cms migrations (DDL), not in this package's runtime. When PR3
 * adds a partial-unique index builder (`lib/indexSql.ts`), this test is relaxed
 * to permit it there and only there.
 */
describe("§3.1 no raw SQL in the package runtime", () => {
  it("no `sql\\`` tagged template or `.execute(sql…)` under src/", () => {
    const offenders: string[] = [];
    // git ls-files avoids node_modules/dist and respects the repo.
    const files = execSync("git ls-files 'src/**/*.ts'", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((f) => f && !f.endsWith(".test.ts"));
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (/(\bsql\s*`|\.execute\s*\(\s*sql`)/.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders, `raw SQL found in: ${offenders.join(", ")}`).toEqual([]);
  });
});
