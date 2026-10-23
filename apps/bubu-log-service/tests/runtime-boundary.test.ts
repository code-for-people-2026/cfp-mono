import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeServer } from "../src/node-server";
import { acquireRuntimeLock } from "../src/runtime-lock";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function serverFixture() {
  let calls = 0;
  const server = createNodeServer(async () => new Response("existing-app"), "http://127.0.0.1", {
    opsOrigin: "https://ops.example.test",
    admin: async (incoming, outgoing) => {
      calls++;
      let body = "";
      for await (const chunk of incoming) body += chunk.toString();
      outgoing.setHeader("Set-Cookie", ["one=1; HttpOnly", "two=2; HttpOnly"]);
      outgoing.end(JSON.stringify({ body, cookie: incoming.headers.cookie }));
    },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test listener unavailable");
  return { url: `http://127.0.0.1:${address.port}`, calls: () => calls };
}

describe("single-process native Admin boundary", () => {
  it("keeps native request bytes/cookies and existing HTTP routes intact", async () => {
    const f = await serverFixture();
    const response = await fetch(`${f.url}/api/cms/ops-users/login`, { method: "POST", headers: { Origin: "https://ops.example.test", Cookie: "bubu-ops-token=opaque" }, body: JSON.stringify({ email: "合成" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ body: JSON.stringify({ email: "合成" }), cookie: "bubu-ops-token=opaque" });
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(await (await fetch(`${f.url}/api/app/chat`)).text()).toBe("existing-app");
  });
  it("rejects missing/foreign Origin on native REST and Admin server actions", async () => {
    const f = await serverFixture();
    for (const pathname of ["/api/cms/ops-users/login", "/admin"]) {
      for (const origin of [undefined, "https://foreign.example.test"]) {
        const response = await fetch(`${f.url}${pathname}`, { method: "POST", headers: origin ? { Origin: origin } : {}, body: "{}" });
        expect(response.status).toBe(403);
      }
    }
    expect(f.calls()).toBe(0);
  });
  it("rejects bearer authentication and oversized native payloads before Next", async () => {
    const f = await serverFixture();
    expect((await fetch(`${f.url}/api/cms/care-events`, { headers: { Authorization: "Bearer family-token" } })).status).toBe(401);
    expect((await fetch(`${f.url}/api/cms/ops-users/login`, { method: "POST", headers: { Origin: "https://ops.example.test" }, body: "x".repeat(1024 * 1024 + 1) })).status).toBe(413);
    expect(f.calls()).toBe(0);
  });
  it("holds an exclusive local lease and releases only its own lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bubu-runtime-lock-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const release = acquireRuntimeLock(directory);
    expect(() => acquireRuntimeLock(directory)).toThrow(/already owned/);
    release();
    const second = acquireRuntimeLock(directory);
    const current = await readFile(join(directory, "runtime.lock"), "utf8");
    release();
    expect(await readFile(join(directory, "runtime.lock"), "utf8")).toBe(current);
    second();
    await writeFile(join(directory, "runtime.lock"), "invalid");
    expect(() => acquireRuntimeLock(directory)).toThrow(/unreadable/);
  });
});
