import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const run = promisify(execFile);
let server: Server;
afterEach(() => {
  server?.close();
});

it.each([
  "current",
  "legacy",
  "missing-chunk",
  "wrong-commit",
  "legacy-renderer",
])("线上发布检查实际读取设置路由、模块与提交：%s", async (scenario) => {
  const expected = "a".repeat(40);
  const files: Record<string, string> = {
    "/chat/index.html": '<script src="/chat/js/app.fixture.js"></script>',
    "/chat/js/app.fixture.js":
      '({path:"pages/chat/index",load:()=>import("./index.chat.js")});' +
      (scenario === "legacy"
        ? ""
        : '({path:"pages/settings/index",load:()=>import("./index.settings.js")});'),
    "/chat/js/index.chat.js":
      "chat-composer input-toggle artifact-surface /api/hello/ag-ui" +
      (scenario === "legacy-renderer" ? "" : " data-surface-id a2ui-surface"),
    "/chat/js/index.settings.js": "settings-page settings-header mode-option",
    "/chat/build-info.json": JSON.stringify({
      commit: scenario === "wrong-commit" ? "b".repeat(40) : expected,
    }),
  };
  if (scenario === "missing-chunk") delete files["/chat/js/index.settings.js"];
  server = createServer((req, res) => {
    const body = files[req.url || ""];
    res.writeHead(body === undefined ? 404 : 200);
    res.end(body || "missing");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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
  if (scenario === "current")
    await expect(result).resolves.toMatchObject({ stderr: "" });
  else
    await expect(result).rejects.toMatchObject({
      stderr: expect.stringContaining(
        scenario === "legacy"
          ? "缺少独立设置路由"
          : scenario === "missing-chunk"
            ? "无法读取发布文件"
            : scenario === "legacy-renderer"
              ? "缺少 CopilotKit A2UI 渲染器"
              : "发布提交不匹配",
      ),
    });
});
