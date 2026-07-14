import { pathToFileURL } from "node:url";
import payload from "payload";
import config from "../payload.config";
import { migrations } from "./generated";
import {
  assertMigrationHead,
  assertMigrationHistorySafe,
  readAppliedMigrations,
} from "./production";

export async function runProductionMigrations(): Promise<string> {
  await payload.init({ config, disableOnInit: true });
  try {
    if (payload.db.name !== "postgres" || payload.db.push) {
      throw new Error("production migrations require PostgreSQL with schema push disabled");
    }
    const expected = migrations.map(({ name }) => name);
    const query = (statement: string) => payload.db.pool.query(statement);
    assertMigrationHistorySafe(await readAppliedMigrations(query), expected);
    await payload.db.migrate();
    assertMigrationHead(await readAppliedMigrations(query), expected);
    return expected.at(-1)!;
  } finally {
    await payload.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProductionMigrations()
    .then((head) => {
      console.log(`✓ cms migration head ${head}`);
      // Payload keeps framework handles alive after adapter destroy.
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "cms migration failed");
      process.exit(1);
    });
}
