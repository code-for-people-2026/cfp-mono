import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MAX_ATTACHMENT_BYTES } from "./records/attachments";

/** Shared by the production entry and real HTTP tests, including UTF-8 byte limits. */
export function createNodeServer(handler: (request: Request) => Promise<Response>, origin: string, options?: {
  admin: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  opsOrigin: string;
}) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const pathname = new URL(incoming.url || "/", origin).pathname;
      if (options && (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/_next/") || pathname === "/api/cms" || pathname.startsWith("/api/cms/"))) {
        // Native Admin server actions and REST retain the original request stream/cookies.
        // Enforce exact-origin CSRF before Next/Payload, including login and server actions.
        if (incoming.headers.authorization) {
          outgoing.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          outgoing.end(JSON.stringify({ code: "OPS_COOKIE_REQUIRED", error: "请使用运营后台登录。" }));
          return;
        }
        if (!["GET", "HEAD"].includes(incoming.method || "GET") && incoming.headers.origin !== options.opsOrigin) {
          outgoing.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          outgoing.end(JSON.stringify({ code: "UNTRUSTED_ORIGIN", error: "请求来源不受信任。" }));
          return;
        }
        const nativeLimit = 1024 * 1024;
        const rejectOversize = () => {
          if (!outgoing.headersSent) outgoing.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          outgoing.end(JSON.stringify({ code: "BODY_TOO_LARGE", error: "请求内容过长。" }));
        };
        if (Number(incoming.headers["content-length"] || 0) > nativeLimit) { rejectOversize(); return; }
        let nativeBytes = 0;
        incoming.on("data", (chunk: Buffer) => {
          nativeBytes += chunk.length;
          if (nativeBytes > nativeLimit) {
            rejectOversize();
            incoming.destroy();
          }
        });
        // Keep the stream paused until Next's parser is attached; counting cannot consume it.
        incoming.pause();
        await options.admin(incoming, outgoing);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const maxBytes = ["/api/app/attachments", "/api/ops/attachment"].includes(pathname) && incoming.method === "POST" ? MAX_ATTACHMENT_BYTES
        : pathname === "/api/mcp" ? 1024 * 1024 : pathname === "/api/app/chat" ? 32768 : pathname.startsWith("/api/ops/") ? 1024 * 1024 : 16384;
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
      const responseHeaders: Record<string, string | string[]> = Object.fromEntries(response.headers.entries());
      const cookies = response.headers.getSetCookie();
      if (cookies.length) responseHeaders["set-cookie"] = cookies;
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!outgoing.headersSent) outgoing.writeHead(500); if (!outgoing.writableEnded) outgoing.end(); }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return server;
}
