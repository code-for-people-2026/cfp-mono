import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfig, getPayload } from "payload";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { openStore, Store, collections, tables } from "../src/store";
import { migrations } from "../src/migrations";
import { recordCollections, recordTables, RecordsRepository } from "../src/records/persistence";
const directory = await mkdtemp(join(tmpdir(), "bubu-production-schema-"));
let store: Store | undefined;
try {
  store = await openStore({ directory, secret: "isolated-production-schema-verification-secret", extensions: recordCollections });
  await store.transaction(async () => { await store!.put("identities", "production-check", { restored: true }); });
  await assert.rejects(store.transaction(async () => {
    await store!.put("identities", "rollback-check", { mustNotPersist: true });
    throw new Error("injected rollback");
  }), /injected rollback/);
  await store.transaction(async req=>{const records=new RecordsRepository(store!.payload);for(const table of recordTables)await records.put(table,"schema-baby",`${table}:persistence`,{persisted:true},req);});
  await store.close(); store = undefined;
  store = await openStore({ directory, secret: "isolated-production-schema-verification-secret", extensions: recordCollections });
  assert.equal((await store.get("identities", "production-check"))?.value.restored, true);
  assert.equal(await store.get("identities", "rollback-check"), undefined);
  await store.transaction(async req=>{const records=new RecordsRepository(store!.payload);for(const table of recordTables)assert.equal((await records.get<{persisted:boolean}>(table,"schema-baby",`${table}:persistence`,req))?.persisted,true);});
  await store.close(); store=undefined;
  const upgradeDirectory=join(directory,"upgrade");await mkdir(upgradeDirectory);
  const secret="isolated-production-upgrade-verification-secret";
  const config=await buildConfig({secret,collections:[...collections],db:sqliteAdapter({client:{url:`file:${upgradeDirectory}/identity.db`},push:false,prodMigrations:[migrations[0]!],transactionOptions:{}}),typescript:{autoGenerate:false},telemetry:false});
  store=new Store(await getPayload({config,key:`old-schema-${upgradeDirectory}`}));
  await store.transaction(async()=>{for(const table of tables)await store!.put(table,`${table}:before-upgrade`,{historical:true});});
  await store.close();store=undefined;
  store=await openStore({directory:upgradeDirectory,secret,extensions:recordCollections});
  for(const table of tables)assert.equal((await store.get(table,`${table}:before-upgrade`))?.value.historical,true);
  await store.transaction(async req=>{const records=new RecordsRepository(store!.payload);for(const table of recordTables)await records.put(table,"schema-baby",`${table}:after-upgrade`,{persisted:true},req);});
  console.log("Production empty initialization, identity-schema upgrade, persistence, rollback and reopen verified in isolated SQLite.");
} finally {
  await store?.close();
  await rm(directory, { recursive: true, force: true });
}
