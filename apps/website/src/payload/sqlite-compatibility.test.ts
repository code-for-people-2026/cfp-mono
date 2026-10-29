import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

test("the website Payload configuration initializes and persists data with SQLite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "website-sqlite-"));
  let payload: import("payload").Payload | undefined;
  try {
    for (const name of ["PAYLOAD_DATABASE_URL", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL", "VERCEL"]) vi.stubEnv(name, "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URI", `file:${join(dir, "website.db")}`);
    vi.stubEnv("PAYLOAD_SECRET", "isolated-website-sqlite-test-only");
    const { getPayload } = await import("payload");
    const { default: config } = await import("@payload-config");
    payload = await getPayload({ config });
    const created = await payload.create({ collection: "form-links", overrideAccess: true, data: { label: "SQLite synthetic check", purpose: "critique", url: "https://example.invalid/test" } });
    const found = await payload.findByID({ collection: "form-links", id: created.id, overrideAccess: true });
    expect(found.label).toBe("SQLite synthetic check");
    await payload.update({ collection: "form-links", id: created.id, overrideAccess: true, data: { label: "SQLite updated" } });
    expect((await payload.findByID({ collection: "form-links", id: created.id, overrideAccess: true })).label).toBe("SQLite updated");
    await payload.delete({ collection: "form-links", id: created.id, overrideAccess: true });
    expect((await payload.count({ collection: "form-links", overrideAccess: true })).totalDocs).toBe(0);
  } finally {
    try { await payload?.destroy(); }
    finally { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); }
  }
}, 30_000);
