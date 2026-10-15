import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const run = promisify(execFile);
let server: Server;
afterEach(() => {
  server?.close();
});

const failures = {
  current: "",
  "escaped-text": "",
  "direct-re-export": "",
  legacy: "缺少独立设置路由",
  "legacy-renderer": "缺少 CopilotKit A2UI 渲染器",
  "missing-chunk": "无法读取发布文件 js/index.settings.js",
  "wrong-commit": "发布提交不匹配",
  "missing-privacy-route": "缺少独立隐私与数据路由",
  "missing-privacy-chunk": "无法读取发布文件 js/index.privacy.js",
  "missing-shared-privacy-chunk": "无法读取发布文件 js/common.privacy.js",
  "empty-privacy-module": "找不到页面导出",
  "all-privacy-home": "遗漏授权管理页：保存授权选择",
  "missing-selected-export": "找不到页面导出",
  "missing-privacy-entry": "遗漏设置页：隐私与数据",
  "missing-authorization-route": "缺少独立授权管理路由",
  "missing-connection-options": "遗漏连接方式页：mode-option",
  "missing-settings-loader": "缺少设置页面模块",
};
const privacyPages = [
  ["privacy", "home", "授权管理 导出数据 删除数据 政策与协议"],
  ["privacy/authorization", "authorization", "保存授权选择"],
  ["privacy/data", "data", "导出我的数据与图片 确认删除在线数据"],
  ["privacy/policies", "policies", "了解服务如何使用、保存和保护你的信息。"],
  ["privacy/document", "document", "未找到这份文件，请返回重新选择。"],
];
const scenarios = [
  ...Object.entries(failures).map(([scenario, failure]) => ({
    scenario,
    failure,
    replaced: "",
    replacement: "",
  })),
  ...privacyPages.flatMap(([, name]) =>
    privacyPages
      .filter(([, other]) => other !== name)
      .map(([, other]) => ({
        scenario: `${name}-points-to-${other}`,
        failure: "发布版本遗漏",
        replaced: name,
        replacement: other,
      })),
  ),
];
it.each(scenarios)(
  "线上发布检查实际读取设置路由、模块与提交：$scenario",
  async ({ scenario, failure, replaced, replacement }) => {
    const expected = "a".repeat(40);
    const routes = [
      ["chat", "chat"],
      ["settings", "settings"],
      ["connection", "connection"],
      ["help", "help"],
      ...privacyPages.map(([route, name]) => [route, "privacy", name]),
    ];
    const files: Record<string, string> = {
      "/chat/index.html": '<script src="/chat/js/app.fixture.js"></script>',
      "/chat/js/app.fixture.js": routes
        .filter(
          ([route]) =>
            !(scenario === "legacy" && route === "settings") &&
            !(scenario === "missing-privacy-route" && route === "privacy") &&
            !(
              scenario === "missing-authorization-route" &&
              route === "privacy/authorization"
            ),
        )
        .map(([route, chunk, selected]) => {
          const direct = selected && scenario === "direct-re-export";
          const selector =
            selected === replaced
              ? replacement
              : scenario === "missing-selected-export" && selected === "home"
                ? "missing"
                : selected;
          const load = `import("./index.${direct ? selected : chunk}.js")${selected && !direct && scenario !== "all-privacy-home" ? `.then(module=>module.${selector})` : ""}`;
          return `({path:"pages/${route}/index",load:()=>${scenario === "missing-settings-loader" && route === "settings" ? "undefined" : load}});`;
        })
        .join(""),
      "/chat/js/index.chat.js":
        "chat-composer input-toggle artifact-surface /api/hello/ag-ui" +
        (scenario === "legacy-renderer" ? "" : " data-surface-id a2ui-surface"),
      "/chat/js/index.settings.js": `settings-page settings-header 连接方式 帮助与反馈 ${scenario === "missing-privacy-entry" ? "" : "隐私与数据"}`,
      "/chat/js/index.connection.js": `生成专用连接令牌 ${scenario === "missing-connection-options" ? "" : "mode-option"}`,
      "/chat/js/index.help.js": "在线反馈暂未开放 联系渠道",
      "/chat/js/index.privacy.js":
        scenario === "empty-privacy-module"
          ? "export{}"
          : scenario === "all-privacy-home"
            ? 'export{home as default}from"./common.privacy.js";'
            : `import{${privacyPages.map(([, name], i) => `${name} as f${i}`).join(",")}}from"./common.privacy.js";` +
              privacyPages
                .map(
                  ([, name], i) =>
                    `const p${i}=Object.freeze(Object.defineProperty({__proto__:null,default:f${i}},Symbol.toStringTag,{value:"Module"}));export{p${i} as ${name}};`,
                )
                .join(""),
      "/chat/js/common.privacy.js": privacyPages
        .map(
          ([, name, markers]) =>
            `function ${name}(){return ${JSON.stringify(markers)}}export{${name}};`,
        )
        .join(""),
      "/chat/build-info.json": JSON.stringify({
        commit: scenario === "wrong-commit" ? "b".repeat(40) : expected,
      }),
    };
    for (const [, name] of privacyPages)
      files[`/chat/js/index.${name}.js`] =
        `export{${name} as default}from"./common.privacy.js";`;
    if (scenario === "missing-chunk")
      delete files["/chat/js/index.settings.js"];
    if (scenario === "missing-privacy-chunk")
      delete files["/chat/js/index.privacy.js"];
    if (scenario === "missing-shared-privacy-chunk")
      delete files["/chat/js/common.privacy.js"];
    if (scenario === "escaped-text") {
      for (const name of Object.keys(files).filter((name) =>
        name.endsWith(".js"),
      ))
        files[name] = files[name].replace(
          /[\u0080-\uffff]/g,
          (character) =>
            `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
        );
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
    if (!failure) await expect(result).resolves.toMatchObject({ stderr: "" });
    else
      await expect(result).rejects.toMatchObject({
        stderr: expect.stringContaining(failure),
      });
  },
);
