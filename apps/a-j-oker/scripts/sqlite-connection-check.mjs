import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the exact native driver resolved by Payload, in an isolated child.
// A successful SQL assertion alone misses the old driver's crash during teardown.
if (process.argv[2] === "--child") {
  const require = createRequire(import.meta.url);
  const adapterRequire = createRequire(require.resolve("@payloadcms/db-sqlite"));
  const { createClient } = adapterRequire("@libsql/client");
  const db = createClient({ url: `file:${process.argv[3]}` });
  const fdCount = () => process.platform === "linux" ? readdirSync("/proc/self/fd").length : null;
  try {
    await db.execute("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    let warmup;
    for (let i = 0; i < 1000; i++) {
      const tx = await db.transaction();
      try {
        await tx.execute({ sql: "INSERT INTO probe(id,value) VALUES (?,?)", args: [i, "synthetic"] });
        if (i % 3 === 0) await tx.commit();
        else if (i % 3 === 1) await tx.rollback();
        else tx.close();
      } finally { tx.close(); }
      if (i % 100 === 0) {
        globalThis.gc?.();
        const fds = fdCount();
        if (i === 100) warmup = fds;
        if (warmup !== undefined && warmup !== null) assert.ok(fds <= warmup + 4, `native handles grew: ${warmup} -> ${fds}`);
      }
    }
    assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM probe")).rows[0].n), 334);
    assert.equal((await db.execute("PRAGMA integrity_check")).rows[0].integrity_check, "ok");
  } finally { db.close(); }
  globalThis.gc?.();
  console.log("PASS: 1000 mixed transactions, committed rows and database integrity; handle plateau checked on Linux");
  // Do not force process.exit(): the parent must observe a clean natural exit.
} else {
  const dir = await mkdtemp(join(tmpdir(), "hello-sqlite-connections-"));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), "--child", join(dir, "test.db")], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { output += data; });
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("native SQLite child failed to exit within 45 seconds")); }, 45_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error(`SQLite child exited ${code ?? signal}: ${output}`));
        else if (!output.includes("PASS: 1000 mixed transactions")) reject(new Error(`SQLite child exited without completing checks: ${output}`));
        else { console.log(output.trim()); resolve(); }
      });
    });
    console.log("PASS: native driver process exited normally");
  } finally { await rm(dir, { recursive: true, force: true }); }
}
