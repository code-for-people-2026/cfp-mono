import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sources(target)
      : /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")
        ? [target]
        : [];
  });
}
describe("架构回归门槛", () => {
  it("浏览器模块不依赖 ADK、Payload 或服务端密钥", () => {
    for (const source of [...sources("src/app/(site)"), ...sources("../hello-agent-miniapp/src")]) {
      const text = readFileSync(source, "utf8");
      expect(text).not.toMatch(
        /from\s+['"](@google\/adk|payload|.*\/cms\/|.*\/server\/|.*\/agent\/|.*\/models\/)/,
      );
      expect(text).not.toContain("process.env.DEEPSEEK_API_KEY");
    }
  });
  it("模型构造只发生在运行模块，不在 MCP 或 CMS 中生成回复", () => {
    for (const source of [...sources("src/server"), ...sources("src/cms")]) {
      expect(readFileSync(source, "utf8")).not.toMatch(
        /new (Gemini|GoogleGenAI|DeepSeekModel|Runner)\(/,
      );
    }
  });
  it("独立客户端不经过平台 ADK，生产代码不实例化 Gemini", () => {
    expect(readFileSync("scripts/external-agent.ts", "utf8")).not.toMatch(
      /from\s+['"](@google\/adk|.*\/cms\/|.*\/agent\/)/,
    );
    for (const source of sources("src")) {
      expect(readFileSync(source, "utf8")).not.toMatch(
        /new (Gemini|GoogleGenAI)\(/,
      );
    }
  });
  it("生产代码不导入测试模型，不接受任意模型网关地址", () => {
    for (const source of sources("src")) {
      const text = readFileSync(source, "utf8");
      expect(text).not.toContain("scripted-model");
      expect(text).not.toContain("HELLO_MOCK");
    }
    expect(readFileSync("src/domain/contracts.ts", "utf8")).not.toContain(
      "baseUrl",
    );
  });
});
