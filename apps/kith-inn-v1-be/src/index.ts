import { serve } from "@hono/node-server";
import { createApp } from "./app";

try {
  process.loadEnvFile();
} catch {
  // 生产环境由运行时注入变量；本地没有 .env 时由 createApp fail closed。
}

const port = Number(process.env.BE_PORT ?? 3311);
serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`kith-inn-v1-be listening on http://localhost:${info.port}`);
});
