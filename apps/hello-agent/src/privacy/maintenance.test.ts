import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Payload } from "payload";
import { expect, it, vi } from "vitest";
import { maintainPrivacy } from "./maintenance";

const cleanup = vi.hoisted(() => vi.fn<(owner: string) => Promise<{ deleted: boolean }>>().mockResolvedValue({ deleted: true }));
vi.mock("./service", () => ({ PrivacyService: class {
  constructor(readonly repo: { owner: { id: string } }) {}
  deleteData() { return cleanup(this.repo.owner.id); }
} }));
it("恢复按有限页只读归属和状态，已删墓碑不阻断后续身份", async () => {
  cleanup.mockClear();
  const directory = await mkdtemp(path.join(tmpdir(), "hello-ledger-pages-"));
  try {
    const ledger = path.join(directory, "ledger.ndjson");
    await writeFile(ledger, ["already-deleted", "remaining"].map((owner) => JSON.stringify({ ownerDigest: createHash("sha256").update(owner).digest("hex") })).join("\n"));
    const source = Array.from({ length: 215 }, (_, index) => ({ id: index + 1, owner: index === 0 ? "already-deleted" : index === 214 ? "remaining" : `other-${index}`, state: index === 0 ? "deleted" : "active", expiresAt: null }));
    const find = vi.fn(async ({ collection, where, select, limit, pagination, sort, depth }) => {
      expect({ limit, pagination, sort, depth }).toEqual({ limit: 100, pagination: false, sort: "id", depth: 0 });
      expect(Object.keys(select).sort()).toEqual((collection === "privacy-profiles" && select.state ? ["id", "owner", "state", "expiresAt"] : ["id", "owner"]).sort());
      const rows = source.filter((row) => row.id > where.id.greater_than).slice(0, limit);
      return { docs: rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => select[key]))) };
    });
    const payload = { find, delete: vi.fn() } as unknown as Payload;
    const result = await maintainPrivacy(payload, { apply: true, restoreLedger: ledger });
    expect(result).toMatchObject({ eligibleIdentities: 2, deleted: 2 });
    expect(cleanup.mock.calls).toEqual([["already-deleted"], ["remaining"]]);
    expect(find).toHaveBeenCalledTimes(24); // profile metadata + seven owner scans, three pages each
  } finally { await rm(directory, { recursive: true, force: true }); }
});
