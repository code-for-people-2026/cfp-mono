import { cp, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// 由服务端同步静态产物，使构建缓存也能完整恢复 /chat，不依赖其他任务的副作用。
const source = fileURLToPath(
  new URL("../../hello-agent-miniapp/dist/h5/", import.meta.url),
);
const target = fileURLToPath(new URL("../public/chat/", import.meta.url));
try {
  await access(`${source}/index.html`);
} catch {
  throw new Error(
    "请先运行 pnpm --filter @cfp/hello-agent-miniapp build:h5，生成 Taro 网页预览。",
  );
}
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log("已同步 Taro H5 到 /chat/index.html；API 与 CMS 保持同源。");
