import { createServer } from "node:http";
import { MAX_ATTACHMENT_BYTES } from "./records/attachments";

/** Shared by the production entry and real HTTP tests, including UTF-8 byte limits. */
export function createNodeServer(handler: (request: Request) => Promise<Response>, origin: string) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      const pathname = new URL(incoming.url || "/", origin).pathname;
      const maxBytes = pathname === "/api/app/attachments" && incoming.method === "POST" ? MAX_ATTACHMENT_BYTES
        : pathname === "/api/mcp" ? 1024 * 1024 : pathname === "/api/app/chat" ? 32768 : 16384;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > maxBytes) {
          outgoing.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          outgoing.end(JSON.stringify({ code: "BODY_TOO_LARGE", error: "请求内容过长。" }));
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const request = new Request(new URL(incoming.url || "/", origin), { method: incoming.method, headers,
        ...(!["GET", "HEAD"].includes(incoming.method || "GET") ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return server;
}
