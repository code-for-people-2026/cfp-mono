import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { collectorHealth, readHostReport } from "../src/operations/health";
import type { CollectorJob } from "../src/collector/service";

it("reads only a bounded strict host report, rejecting secrets, symlinks and writable metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bubu-ops-report-")), file = path.join(root, "status.json");
  const value = { version: 1, backup: { state: "verified", at: "2026-10-24T00:00:00Z", lastVerifiedAt: "2026-10-24T00:00:00Z" } };
  try {
    expect(await readHostReport(undefined)).toBeUndefined();
    await writeFile(file, JSON.stringify(value), { mode: 0o644 }); expect(await readHostReport(file)).toEqual(value);
    await symlink(file, path.join(root, "link")); await expect(readHostReport(path.join(root, "link"))).rejects.toThrow();
    await writeFile(file, JSON.stringify({ ...value, error: "private-path-or-credentials" })); await expect(readHostReport(file)).rejects.toThrow();
    await writeFile(file, " ".repeat(8200)); await expect(readHostReport(file)).rejects.toThrow();
    await writeFile(path.join(root, "unsafe"), JSON.stringify(value), { mode: 0o666 });
    const { chmod } = await import("node:fs/promises"); await chmod(path.join(root, "unsafe"), 0o666);
    await expect(readHostReport(path.join(root, "unsafe"))).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("warns about late/failed collection without exposing source identity or inferring baby health", () => {
  const now = Date.parse("2026-10-24T00:10:00Z");
  const job: CollectorJob = { id: "private-job", babyId: "private-baby", groupId: "private-group", accountId: "private-account", chatId: "private-chat", agentId: "private-agent", enabled: true, intervalMs: 60000, cursor: {}, nextRunAt: "2026-10-24T00:00:00Z", backfills: [] };
  expect(collectorHealth([], now).level).toBe("unconfigured");
  expect(collectorHealth([job], now).level).toBe("warning");
  expect(collectorHealth([{ ...job, heartbeatAt: "2026-10-24T00:09:00Z" }], now).level).toBe("ok");
  expect(collectorHealth([{ ...job, failure: { at: "2026-10-24T00:09:00Z", attempts: 1, code: "FAILED" } }], now).level).toBe("critical");
  expect(JSON.stringify(collectorHealth([job], now))).not.toContain("private-");
});
