import next from "next";
import type { BubuRuntime } from "./runtime";
import { serviceDirectory } from "./runtime-config";
import { createNodeServer } from "./node-server";

/** Used by production and isolated browser fixtures; Next runs in the owning runtime process. */
export async function startRuntimeServer(runtime: BubuRuntime, options: { port: number; hostname?: string; production?: boolean }) {
  const hostname = options.hostname || "127.0.0.1";
  const app = next({ dev: !options.production, dir: serviceDirectory, hostname, port: options.port });
  try { await app.prepare(); }
  catch (error) { await runtime.close(); throw error; }
  const server = createNodeServer(runtime.handler, runtime.opsOrigin, { admin: app.getRequestHandler(), opsOrigin: runtime.opsOrigin });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, hostname, () => { server.off("error", reject); resolve(); });
    });
  } catch (error) { await app.close(); await runtime.close(); throw error; }
  let closed = false;
  return {
    server,
    close: async () => {
      if (closed) return;
      closed = true;
      await runtime.chat.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await app.close();
      await runtime.close();
    },
  };
}
