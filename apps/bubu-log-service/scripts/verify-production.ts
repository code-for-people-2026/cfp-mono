import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "../src/store";
const directory = await mkdtemp(join(tmpdir(), "bubu-production-schema-"));
let store: Store | undefined;
try {
  store = await openStore({ directory, secret: "isolated-production-schema-verification-secret" });
  await store.transaction(async () => { await store!.put("identities", "production-check", { restored: true }); });
  await assert.rejects(store.transaction(async () => {
    await store!.put("identities", "rollback-check", { mustNotPersist: true });
    throw new Error("injected rollback");
  }), /injected rollback/);
  await store.close(); store = undefined;
  store = await openStore({ directory, secret: "isolated-production-schema-verification-secret" });
  assert.equal((await store.get("identities", "production-check"))?.value.restored, true);
  assert.equal(await store.get("identities", "rollback-check"), undefined);
  console.log("Production migrations, persistence, rollback and reopen verified in isolated SQLite.");
} finally {
  await store?.close();
  await rm(directory, { recursive: true, force: true });
}
