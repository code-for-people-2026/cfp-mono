import { pathToFileURL } from "node:url";
import payload from "payload";
import config from "../payload.config";
import { readKithInnBusinessSnapshot } from "../src/smoke/businessSnapshot";

export async function captureKithInnBusinessSnapshot() {
  await payload.init({ config, disableOnInit: true });
  try {
    if (payload.db.name !== "postgres" || payload.db.push) throw new Error("production database required");
    return await readKithInnBusinessSnapshot((statement) => payload.db.pool.query(statement));
  } finally {
    await payload.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  captureKithInnBusinessSnapshot()
    .then((counts) => {
      console.log(JSON.stringify({ status: "captured", counts }));
      process.exit(0);
    })
    .catch(() => {
      console.error('{"status":"failed","error":"business_snapshot_unavailable"}');
      process.exit(1);
    });
}
