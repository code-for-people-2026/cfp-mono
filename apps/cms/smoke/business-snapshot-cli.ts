import { writeSync } from "node:fs";
import { getPayload } from "payload";
import { createBusinessSnapshot, type SnapshotClient } from "./business-snapshot";

let payload: Awaited<ReturnType<typeof getPayload>> | undefined;
let output: unknown;
let exitCode = 0;
try {
  const { default: config } = await import("../payload.config");
  payload = await getPayload({ config });
  output = await createBusinessSnapshot(
    payload as unknown as SnapshotClient,
    process.env.KITH_INN_PROVISIONED_SELLER_ID ?? "",
  );
} catch {
  output = { status: "failed", error: "business_snapshot_failed" };
  exitCode = 1;
}
await payload?.destroy().catch(() => {
  output = { status: "failed", error: "business_snapshot_failed" };
  exitCode = 1;
});
// Payload's PostgreSQL pool can keep the short-lived ops process alive after destroy.
writeSync(exitCode === 0 ? 1 : 2, `${JSON.stringify(output)}\n`);
process.exit(exitCode);
