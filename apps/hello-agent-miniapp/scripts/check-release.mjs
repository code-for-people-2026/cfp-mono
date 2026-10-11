import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";

const base = process.argv[2];
const app = fileURLToPath(new URL("..", import.meta.url));
const read = async (name) => {
  if (!base) return readFile(path.join(app, "dist/h5", name), "utf8");
  const response = await globalThis.fetch(new URL(`/chat/${name}`, base));
  assert.equal(response.status, 200, `无法读取发布文件 ${name}`);
  return response.text();
};
const html = await read("index.html");
const bootstrapPath = html.match(/src="\/chat\/(js\/app\.[^"\s]+\.js)"/)?.[1];
assert.ok(bootstrapPath, "缺少 H5 入口");
const bootstrap = await read(bootstrapPath);
const chatPath = bootstrap.match(/import\("\.\/(index\.[^"\s]+\.js)"\)/)?.[1];
assert.ok(chatPath, "缺少聊天页面模块");
const chat = await read(`js/${chatPath}`);
for (const marker of ["chat-composer", "input-toggle", "artifact-surface"]) {
  assert.ok(chat.includes(marker), `测试版遗漏功能：${marker}`);
}
const imports = [...chat.matchAll(/from"\.\/([^"\s]+\.js)"/g)].map(
  (match) => match[1],
);
const dependencies = await Promise.all(
  [...new Set(imports)].map((name) => read(`js/${name}`)),
);
assert.ok(
  [chat, ...dependencies].some((code) => code.includes("/api/hello/ag-ui")),
  "缺少 AG-UI 请求",
);
if (!base) {
  const mini = await readFile(
    path.join(app, "dist/weapp/pages/chat/index.js"),
    "utf8",
  );
  for (const marker of ["chat-composer", "input-toggle", "artifact-surface"])
    assert.ok(mini.includes(marker), `小程序遗漏功能：${marker}`);
  const config = JSON.parse(
    await readFile(path.join(app, "dist/weapp/app.json"), "utf8"),
  );
  assert.ok(config.plugins?.WechatSI, "小程序遗漏语音插件");
  assert.ok((await readdir(path.join(app, "dist/weapp"))).length > 0);
}
console.log("✓ 实际发布包包含新版输入栏、语音切换、作品与 AG-UI 请求");
