import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** A local process lease, shared by the server and offline administrator tools. */
export function acquireRuntimeLock(directory: string): () => void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, "runtime.lock");
  const nonce = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(filename, JSON.stringify({ pid: process.pid, nonce }), { flag: "wx", mode: 0o600 });
      return () => {
        try {
          const current = JSON.parse(readFileSync(filename, "utf8"));
          if (current.pid === process.pid && current.nonce === nonce) rmSync(filename);
        } catch { /* A missing lock needs no cleanup. Never remove another process's lease. */ }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: { pid?: number };
      try { owner = JSON.parse(readFileSync(filename, "utf8")); }
      catch { throw new Error("The identity directory has an unreadable runtime lock. Stop all writers and inspect runtime.lock before restarting."); }
      if (!Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0) throw new Error("Invalid runtime lock; refusing to open the database.");
      try { process.kill(owner.pid!, 0); }
      catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code === "ESRCH") {
          throw new Error(`Stale runtime lock belongs to stopped process ${owner.pid}. Confirm all writers are stopped, then remove runtime.lock explicitly.`);
        }
      }
      throw new Error(`The identity directory is already owned by process ${owner.pid}. Only one Bubu service or offline administration process may write it.`);
    }
  }
  throw new Error("Could not acquire the identity directory runtime lock.");
}
