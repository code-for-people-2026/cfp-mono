import { createServer } from "node:http";
import { cms } from "../src/cms/client";
import { onboardingPreview, cleanOnboardingPreview } from "../src/age/preview";

if (process.env.HELLO_PREVIEW_SCOPE !== "login-and-birthday" || !process.env.HELLO_DATABASE_URI?.includes("onboarding-preview")) throw new Error("An explicit preview scope and separate preview database are required");
if (process.env.DEEPSEEK_API_KEY || process.env.HELLO_AGE_SECRET_KEY) throw new Error("Do not mount model or age-provider credentials in this preview");
const payload = await cms();
await cleanOnboardingPreview(payload);
let cleaning = false;
const timer = setInterval(async () => {
  if (cleaning) return;
  cleaning = true;
  try { await cleanOnboardingPreview(payload); }
  catch { console.error("Onboarding preview retention cleanup failed; stopping the preview."); server.close(); await payload.destroy(); process.exit(1); }
  finally { cleaning = false; }
}, 3600_000);
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 192 * 1024) { outgoing.writeHead(413); outgoing.end(); return; }
      chunks.push(Buffer.from(chunk));
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const method = incoming.method || "GET";
    const request = new Request(new URL(incoming.url || "/", "http://localhost"), { method, headers, ...(method !== "GET" && method !== "HEAD" ? { body: Buffer.concat(chunks) } : {}) });
    const response = await onboardingPreview(payload, request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('{"error":"预览暂时不可用"}'); }
});
server.listen(Number(process.env.PORT || 3310), "0.0.0.0", () => console.log("Login and birthday preview is listening."));
async function stop() { clearInterval(timer); server.close(); await payload.destroy(); process.exit(0); }
process.once("SIGTERM", stop); process.once("SIGINT", stop);
