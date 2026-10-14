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
const settingsPath = bootstrap.match(
  /path:"pages\/settings\/index",load:[\s\S]*?import\("\.\/([^"\s]+\.js)"\)/,
)?.[1];
assert.ok(settingsPath, "发布版本缺少独立设置路由");
const settings = await read(`js/${settingsPath}`);
for (const marker of ["settings-page", "settings-header", "mode-option"])
  assert.ok(settings.includes(marker), `发布版本遗漏设置页：${marker}`);
if (process.env.HELLO_EXPECTED_COMMIT) {
  const info = JSON.parse(await read("build-info.json"));
  assert.equal(
    info.commit,
    process.env.HELLO_EXPECTED_COMMIT,
    "发布提交不匹配",
  );
}
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
  assert.ok(config.pages.includes("pages/settings/index"), "遗漏独立设置页");
  const chatNavigation = JSON.parse(
    await readFile(path.join(app, "dist/weapp/pages/chat/index.json"), "utf8"),
  );
  const settingsNavigation = JSON.parse(
    await readFile(
      path.join(app, "dist/weapp/pages/settings/index.json"),
      "utf8",
    ),
  );
  assert.equal(
    chatNavigation.navigationStyle,
    "custom",
    "聊天页应仅使用自定义导航",
  );
  assert.equal(
    settingsNavigation.navigationStyle,
    "default",
    "微信设置页应使用原生返回导航",
  );
  assert.ok((await readdir(path.join(app, "dist/weapp"))).length > 0);
}
console.log(
  "✓ 实际发布包包含独立设置页、新版输入栏、语音切换、作品与 AG-UI 请求",
);
