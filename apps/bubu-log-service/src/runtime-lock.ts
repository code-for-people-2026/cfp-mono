import { mkdirSync, openSync, closeSync, fstatSync, readFileSync, constants } from "node:fs";
import path from "node:path";
import { flockSync } from "fs-ext";

/** A kernel-owned lease on a permanent empty inode. Closing the descriptor or
 * process death releases ownership; neither PID reuse nor stale JSON can own it.
 * Never unlink this file: that would allow a second writer on a new inode.
 * Upgrading from the old PID lease requires a stopped-writer deployment step.
 */
export function acquireRuntimeLock(directory: string): () => void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fd = openSync(path.join(directory, "runtime.lock"), constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("Invalid runtime lock; refusing to open the database.");
    try { flockSync(fd, "exnb"); }
    catch (error) {
      if (["EAGAIN", "EWOULDBLOCK"].includes((error as NodeJS.ErrnoException).code || "")) {
        throw new Error("The identity directory is already owned by a live process. Only one Bubu writer may open it.");
      }
      throw error;
    }
    // Older binaries use O_EXCL and will refuse even this empty inode. Never
    // infer that an old PID belongs to this container or reclaim a legacy lease.
    if (readFileSync(fd, "utf8").length) throw new Error("Legacy or unreadable runtime lock: stop all writers and archive runtime.lock before the first upgraded start.");
    let released = false;
    return () => { if (!released) { released = true; closeSync(fd); } };
  } catch (error) { closeSync(fd); throw error; }
}
