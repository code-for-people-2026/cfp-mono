import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";
import { createPageReader } from "./release-page-module.mjs";

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
const settingsPages = [
  ["pages/settings/index", "设置", ["settings-page", "settings-header", "连接方式", "隐私与数据", "帮助与反馈"]],
  ["pages/connection/index", "连接方式", ["mode-option", "生成专用连接令牌"]],
  ["pages/help/index", "帮助与反馈", ["在线反馈暂未开放", "联系渠道"]],
  ["pages/privacy/index", "隐私与数据", ["授权管理", "导出数据", "删除数据", "政策与协议"]],
  ["pages/privacy/authorization/index", "授权管理", ["保存授权选择"]],
  ["pages/privacy/data/index", "数据管理", ["导出我的数据与图片", "确认删除在线数据"]],
  ["pages/privacy/policies/index", "政策与协议", ["了解服务如何使用、保存和保护你的信息。"]],
  ["pages/privacy/document/index", "政策正文", ["未找到这份文件，请返回重新选择。"]],
];
const readPage = createPageReader(bootstrap, read);
for (const [route, title, markers] of settingsPages) {
  const page = await readPage(route, title);
  for (const marker of markers)
    assert.ok(page.includes(marker), `发布版本遗漏${title}页：${marker}`);
}
if (process.env.HELLO_EXPECTED_COMMIT) {
  const info = JSON.parse(await read("build-info.json"));
  assert.equal(
    info.commit,
    process.env.HELLO_EXPECTED_COMMIT,
    "发布提交不匹配",
  );
}
const chat = await readPage("pages/chat/index", "聊天");
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
  for (const [route, title] of settingsPages) {
    assert.ok(config.pages.includes(route), `小程序遗漏独立${title}页`);
    await readFile(path.join(app, `dist/weapp/${route}.js`), "utf8");
  }
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
  "✓ 实际发布包包含设置入口、连接方式、隐私管理及协议子页面、帮助反馈、新版输入栏、语音切换、作品与 AG-UI 请求",
);
