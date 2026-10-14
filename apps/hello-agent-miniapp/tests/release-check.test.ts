import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const run = promisify(execFile);
let server: Server;
afterEach(() => { server?.close(); });

const failures = {
  current: "",
  "escaped-text": "",
  legacy: "缺少独立设置路由",
  "missing-chunk": "无法读取发布文件 js/index.settings.js",
  "wrong-commit": "发布提交不匹配",
  "missing-privacy-route": "缺少独立隐私与数据路由",
  "missing-privacy-chunk": "无法读取发布文件 js/index.privacy.js",
  "missing-shared-privacy-chunk": "无法读取发布文件 js/common.privacy.js",
  "empty-privacy-module": "遗漏隐私与数据页：授权管理",
  "missing-privacy-entry": "遗漏设置页：隐私与数据",
  "missing-authorization-route": "缺少独立授权管理路由",
  "missing-connection-options": "遗漏连接方式页：mode-option",
  "missing-settings-loader": "缺少设置页面模块",
};
it.each(Object.keys(failures) as Array<keyof typeof failures>)(
  "线上发布检查实际读取设置路由、模块与提交：%s",
  async (scenario) => {
    const expected = "a".repeat(40);
    const routes = [
      ["chat", "chat"], ["settings", "settings"], ["connection", "connection"], ["help", "help"],
      ["privacy", "privacy"], ["privacy/authorization", "privacy"], ["privacy/data", "privacy"],
      ["privacy/policies", "privacy"], ["privacy/document", "privacy"],
    ];
    const files: Record<string, string> = {
      "/chat/index.html": '<script src="/chat/js/app.fixture.js"></script>',
      "/chat/js/app.fixture.js": routes.filter(([route]) =>
        !(scenario === "legacy" && route === "settings") &&
        !(scenario === "missing-privacy-route" && route === "privacy") &&
        !(scenario === "missing-authorization-route" && route === "privacy/authorization"),
      ).map(([route, chunk]) =>
        `({path:"pages/${route}/index",load:()=>${scenario === "missing-settings-loader" && route === "settings" ? "undefined" : `import("./index.${chunk}.js")`}});`,
      ).join(""),
      "/chat/js/index.chat.js":
        "chat-composer input-toggle artifact-surface /api/hello/ag-ui",
      "/chat/js/index.settings.js": `settings-page settings-header 连接方式 帮助与反馈 ${scenario === "missing-privacy-entry" ? "" : "隐私与数据"}`,
      "/chat/js/index.connection.js": `生成专用连接令牌 ${scenario === "missing-connection-options" ? "" : "mode-option"}`,
      "/chat/js/index.help.js": "提交反馈 刷新受理记录",
      "/chat/js/index.privacy.js": scenario === "empty-privacy-module" ? "export{}" : 'export{PrivacyHome as default}from"./common.privacy.js";',
      "/chat/js/common.privacy.js": "授权管理 导出数据 删除数据 政策与协议 保存授权选择 导出我的数据与图片 确认删除在线数据 政策正文",
      "/chat/build-info.json": JSON.stringify({
        commit: scenario === "wrong-commit" ? "b".repeat(40) : expected,
      }),
    };
    if (scenario === "missing-chunk")
      delete files["/chat/js/index.settings.js"];
    if (scenario === "missing-privacy-chunk")
      delete files["/chat/js/index.privacy.js"];
    if (scenario === "missing-shared-privacy-chunk")
      delete files["/chat/js/common.privacy.js"];
    if (scenario === "escaped-text") {
      for (const name of Object.keys(files).filter((name) => name.endsWith(".js")))
        files[name] = files[name].replace(/[\u0080-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
    }
    server = createServer((req, res) => {
      const body = files[req.url || ""];
      res.writeHead(body === undefined ? 404 : 200);
      res.end(body || "missing");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("测试服务器未启动");
    const result = run(
      process.execPath,
      ["scripts/check-release.mjs", `http://127.0.0.1:${address.port}`],
      {
        env: { ...process.env, HELLO_EXPECTED_COMMIT: expected },
      },
    );
    if (!failures[scenario])
      await expect(result).resolves.toMatchObject({ stderr: "" });
    else
      await expect(result).rejects.toMatchObject({
        stderr: expect.stringContaining(
          failures[scenario],
        ),
      });
  },
);
