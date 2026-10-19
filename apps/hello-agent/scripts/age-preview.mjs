// Local-only inspection with an isolated DB, static directory and API port.
// No provider mocks, no real credentials, no schema writes to existing previews.
import { createServer } from "node:http";
import { readFile, mkdir, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(app, "../..");
const dir = path.join(root, ".codex-tmp/age-verification/preview");
await mkdir(dir, { recursive: true });
const env = { ...process.env,
  HELLO_DATABASE_URI: `file:${dir}/preview.db`, PAYLOAD_SECRET: "local-age-preview-only-not-for-deployment",
  HELLO_DEPLOYED: "true", HELLO_ORIGIN: "http://127.0.0.1:3347", HELLO_NEXT_DIST_DIR: ".next-age-verification",
  HELLO_PRIVACY_DELETION_LEDGER: `${dir}/deletions.ndjson`, HELLO_MEDIA_STORAGE: "database",
  DEEPSEEK_API_KEY: "", HELLO_WECHAT_APP_ID: "", HELLO_WECHAT_APP_SECRET: "",
  HELLO_AGE_SECRET_ID: "", HELLO_AGE_SECRET_KEY: "", HELLO_AGE_SESSION_TOKEN: "", HELLO_AGE_PROVIDER_APPROVED: "false", HELLO_AGE_PROVIDER_DISCLOSURE: "",
};
const run = (args, options = {}) => spawn("pnpm", args, { cwd: app, env, ...options });
const init = run(["exec", "tsx", "scripts/init-db.ts"], { stdio: "inherit", env: { ...env, HELLO_DEPLOYED: "false" } });
if (await new Promise((resolve) => init.on("exit", resolve)) !== 0) throw new Error("Isolated database initialization failed");
const log = await open(path.join(dir, "server.log"), "a");
const backend = run(["exec", "next", "start", "-H", "127.0.0.1", "-p", "3348"], { stdio: ["ignore", log.fd, log.fd] });
const staticRoot = path.resolve(root, "apps/hello-agent-miniapp/dist-age-verification/h5");
const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:3347");
    if (url.pathname === "/" || url.pathname.startsWith("/chat/")) {
      const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(6)) || "index.html";
      const file = path.resolve(staticRoot, relative);
      if (!file.startsWith(staticRoot + path.sep)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(file);
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(bytes);
      return;
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const upstream = await fetch(`http://127.0.0.1:3348${req.url}`, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([key]) => !["host", "connection", "content-length"].includes(key)).map(([key, value]) => [key, key === "origin" && value === "http://localhost:3347" ? "http://127.0.0.1:3347" : value])), ...(chunks.length ? { body: Buffer.concat(chunks) } : {}), redirect: "manual" });
    const headers = Object.fromEntries(upstream.headers.entries()); delete headers["content-encoding"]; delete headers["content-length"];
    res.writeHead(upstream.status, headers).end(Buffer.from(await upstream.arrayBuffer()));
  } catch { res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end("本地预览准备中，请稍后刷新"); }
});
server.listen(3347, "127.0.0.1", () => console.log("年龄核验本地预览：http://127.0.0.1:3347/chat/index.html（未配置真实供应商，无模拟成年入口）"));
const close = () => { server.close(); backend.kill("SIGTERM"); void log.close(); };
process.on("SIGINT", close); process.on("SIGTERM", close);
backend.on("exit", () => { server.close(); void log.close(); });
