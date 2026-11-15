import { afterEach, expect, test } from "vitest";
import type { Server } from "node:http";
import { createNodeServer } from "../src/node-server";
import { chatInputSchema } from "../src/chat/contracts";

let server: Server | undefined;
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
});

test("production HTTP transport accepts 6000 Chinese characters with attachment and context metadata", async () => {
  server = createNodeServer(async request => {
    const value = chatInputSchema.parse(await request.json());
    return Response.json({ received: value.text, attachments: value.attachmentIds });
  }, "http://127.0.0.1");
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No TCP address");
  const url = `http://127.0.0.1:${address.port}/api/app/chat`;
  const input = { babyId: "baby-a", requestId: "utf8-chinese-max", text: "奶".repeat(6000), attachmentIds: ["att_" + "a".repeat(64)], context: { viewedDate: "2026-10-23", selectedEventId: "event-original" } };
  const body = JSON.stringify(input);
  expect(Buffer.byteLength(body)).toBeGreaterThan(16384);
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: input.text, attachments: input.attachmentIds });
  const oversized = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, text: "奶".repeat(12000) }) });
  expect(oversized.status).toBe(413);
  expect(await oversized.json()).toMatchObject({ code: "BODY_TOO_LARGE" });
});
