import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CollectionConfig } from "payload";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { IdentityService } from "../../src/identity";
import { openStore, type Store } from "../../src/store";
import { AttachmentService } from "../../src/records/attachments";
import { recordCollections } from "../../src/records/persistence";
import { RecordsService } from "../../src/records/service";
import { CollectorService } from "../../src/collector/service";
import { WechatFixture } from "./identity";
import { RecordsLegacyFixture } from "./records";
import type { ProviderInput } from "../../src/chat/contracts";

/** Parse only the server-generated typed context/input envelopes; ordinary chat text is not authority. */
export function chatModelContext(input: ProviderInput): Record<string, unknown> {
  for (const message of [...input.messages].reverse()) {
    if (message.role !== "user" || typeof message.content !== "string") continue;
    try { const value = JSON.parse(message.content) as Record<string, unknown>; if (value.type === "bubu_chat_context") return value; }
    catch { /* A previous plain user message is not a context envelope. */ }
  }
  throw new Error("Missing trusted chat context in fixture provider input");
}
export function chatUserInput(input: ProviderInput): { text: string; attachmentIds: string[] } {
  for (const message of [...input.messages].reverse()) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== "text") continue;
      try {
        const value = JSON.parse(part.text) as Record<string, unknown>;
        if (value.type === "bubu_user_input") return { text: String(value.text || ""), attachmentIds: Array.isArray(value.attachmentIds) ? value.attachmentIds.map(String) : [] };
      } catch { /* Not the service's input envelope. */ }
    }
  }
  throw new Error("Missing chat input envelope in fixture provider input");
}

/** Only the existing remote business boundary and model are controlled; HTTP, MCP and Payload are real. */
export async function chatFixture(extensions: CollectionConfig[]) {
  const directory = await mkdtemp(path.join(tmpdir(), "bubu-chat-test-"));
  const legacy = new RecordsLegacyFixture(), wechat = new WechatFixture();
  let now = Date.parse("2026-10-23T12:00:00.000Z");
  const open = async () => {
    const previous = process.env.PAYLOAD_FORCE_DRIZZLE_PUSH;
    process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = "true";
    try { return await openStore({ directory, extensions: [...recordCollections, ...extensions] }); }
    finally { if (previous === undefined) delete process.env.PAYLOAD_FORCE_DRIZZLE_PUSH; else process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = previous; }
  };
  let store: Store = await open();
  let identity = new IdentityService(store, legacy, wechat, () => now);
  let attachments = new AttachmentService(identity, { directory });
  let records = new RecordsService(identity, legacy, (...args) => attachments.validateAttachment(...args));
  let collector = new CollectorService(identity, (...args) => records.verifyCollectorReceipt(...args));
  const aliceToken = (await identity.loginLegacy("old-alice", "correct-password", "native")).token;
  const bobToken = (await identity.loginLegacy("old-bob", "correct-password", "native")).token;
  const alice = await identity.authenticate(aliceToken, "bearer"), bob = await identity.authenticate(bobToken, "bearer");
  const operatorToken = (await identity.provisionOperator("chat-test-operator", "baby-a", 3_600_000)).token;
  const operator = await identity.authenticate(operatorToken, "bearer");
  const clients: Client[] = [];
  let server: Server | undefined, origin = "", handler: ((request: Request) => Promise<Response>) | undefined;
  const mcpRequests: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let loseToolResponse: string | undefined;
  async function closeServer() {
    await Promise.all(clients.splice(0).map(client => client.close()));
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  }
  return {
    directory, legacy, aliceToken, bobToken, alice, bob, operatorToken, operator, mcpRequests,
    get store() { return store; }, get identity() { return identity; }, get attachments() { return attachments; },
    get records() { return records; }, get collector() { return collector; }, get origin() { return origin; },
    advance(ms: number) { now += ms; },
    loseToolResponseOnce(name: string) { loseToolResponse = name; },
    setHandler(value: (request: Request) => Promise<Response>) { handler = value; },
    async listen() {
      server = createServer(async (incoming, outgoing) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
          const bytes = Buffer.concat(chunks), headers = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          let lost = false;
          if (incoming.url === "/api/mcp") {
            const rpc = JSON.parse(bytes.toString()) as { method?: string; params?: { name: string; arguments: Record<string, unknown> } };
            if (rpc.method === "tools/call" && rpc.params) {
              mcpRequests.push(structuredClone(rpc.params));
              if (loseToolResponse === rpc.params.name) { loseToolResponse = undefined; lost = true; }
            }
          }
          if (!handler) throw new Error("Fixture handler has not been installed");
          const response = await handler(new Request(new URL(incoming.url || "/", origin), {
            method: incoming.method, headers, ...(!["GET", "HEAD"].includes(incoming.method || "GET") ? { body: new Uint8Array(bytes) } : {}),
          }));
          // Lose only the network response after the actual MCP handler has committed its work.
          if (lost) { outgoing.destroy(); return; }
          outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch { outgoing.writeHead(500); outgoing.end(); }
      });
      await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected loopback TCP server");
      origin = `http://127.0.0.1:${address.port}`;
    },
    async connect(token = aliceToken) {
      const client = new Client({ name: "bubu-chat-integration", version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}`, "X-Bubu-Client": "native" } } }));
      clients.push(client); return client;
    },
    async restart() {
      await closeServer(); await store.close(); store = await open();
      identity = new IdentityService(store, legacy, wechat, () => now);
      attachments = new AttachmentService(identity, { directory });
      records = new RecordsService(identity, legacy, (...args) => attachments.validateAttachment(...args));
      collector = new CollectorService(identity, (...args) => records.verifyCollectorReceipt(...args));
    },
    async close() { await closeServer(); await store.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
export type ChatFixture = Awaited<ReturnType<typeof chatFixture>>;
