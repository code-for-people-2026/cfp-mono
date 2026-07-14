import payload from "payload";
import config from "../../payload.config";
import { prepareCmsBaselineAdoption } from "./migrationHead";

process.env.PAYLOAD_MIGRATING = "true";

async function main(): Promise<void> {
  await payload.init({ config, disableOnInit: true });
  try {
    await prepareCmsBaselineAdoption(payload);
    await payload.db.migrate();
  } finally {
    await payload.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("CMS production migration failed:", error);
    process.exit(1);
  },
);
