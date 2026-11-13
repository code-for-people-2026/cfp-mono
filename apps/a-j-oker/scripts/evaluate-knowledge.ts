import "./load-local-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

if (!process.env.DEEPSEEK_API_KEY || !process.env.HELLO_IMA_KB_ID)
  throw new Error(
    "需要模型凭证和 HELLO_IMA_KB_ID；不能把夹具当成真实知识库实测",
  );
const directory = await mkdtemp(
  path.join(tmpdir(), "aq-knowledge-evaluation-"),
);
process.env.HELLO_DATABASE_URI = `file:${directory}/evaluation.db`;
process.env.HELLO_ADMIN_BOOTSTRAP = "false";
process.env.PAYLOAD_SECRET ||= "isolated-knowledge-evaluation-only";
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { readTurnKnowledge } = await import("../src/agent/knowledge-evidence");
const payload = await cms();
const results: unknown[] = [];
let failures = 0;
try {
  await (await import("../src/cms/seed")).seedAgents(payload);
  const cbt = (
    await payload.find({
      collection: "agent-configs",
      where: { key: { equals: "cbt" } },
    })
  ).docs[0];
  const main = (
    await payload.find({
      collection: "agent-configs",
      where: { key: { equals: "coordinator" } },
    })
  ).docs[0];
  await payload.update({
    collection: "agent-configs",
    id: main.id,
    data: {
      prompt:
        main.prompt +
        "\n评测设置：这批虚构素材统一咨询 CBT 专家；如有绑定资料，统一使用 knowledgeQuery 自动思维。保持原有安全要求。",
    },
  });
  const ima = await payload.create({
    collection: "knowledge-bases",
    data: {
      name: "认知行为治疗（CBT）系统学习计划",
      provider: "ima",
      enabled: true,
      knowledgeBaseId: process.env.HELLO_IMA_KB_ID,
      clientId: (
        await readFile(path.join(homedir(), ".config/ima/client_id"), "utf8")
      ).trim(),
      apiKey: (
        await readFile(path.join(homedir(), ".config/ima/api_key"), "utf8")
      ).trim(),
    },
  });
  const control = await payload.create({
    collection: "knowledge-bases",
    data: {
      name: "知识接入验收卡（人为测试资料，不是临床指南）",
      provider: "inline",
      enabled: true,
      content:
        "这是一份仅用于软件验收的虚构资料。示例自动思维记录卡的标题是：青橙记录卡 KBT-731。表单依次包括：可核对的事实、脑中跳出的解释、另一种可能、愿意尝试的一小步。该名称是验收标记，不是临床术语。不得宣称该卡有治疗效果。",
    },
  });
  const repo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
  const service = new GreetingService(repo);
  const prompts = [
    "虚构测试：开会说错数字，我已经更正，却想着同事肯定觉得我很差。请用 CBT 自动思维记录回应，给一个可以填写的简短表单；如果参考资料提供记录卡名称，请保留卡名。",
    "虚构测试：朋友一天没有回消息，我猜他讨厌我，但并没有其他证据。请用 CBT 自动思维视角帮我区分事实和猜测，给简短卡片。",
    "虚构测试：今天没完成一项计划，就想我做什么都不行。请用 CBT 自动思维视角回应，给一个很小的可选行动。",
  ];
  for (const [condition, ids] of [
    ["未绑定", []],
    ["绑定真实 ima 订阅库", [ima.id]],
    ["可读正文阳性对照", [control.id]],
  ] as const) {
    await payload.update({
      collection: "agent-configs",
      id: cbt.id,
      data: { knowledgeBases: [...ids] },
    });
    for (const [index, input] of prompts.entries()) {
      if (condition === "可读正文阳性对照" && index > 0) break;
      const session = await service.createSession(
        `知识对照：${condition} ${index + 1}`,
      );
      try {
        const row = await service.generateGreeting({
          sessionId: session.id,
          requestId: randomUUID(),
          mode: "platform",
          input: { text: input },
        });
        const evidence = await readTurnKnowledge(payload, row.id);
        assert.equal(row.status, "completed");
        assert.ok(
          evidence.some((expert) => expert.approach === "cbt"),
          "必须实际执行 CBT 专家",
        );
        const sources = evidence.flatMap((expert) => expert.sources);
        const metrics = {
          condition,
          case: index + 1,
          status: row.status,
          durationMs: row.durationMs,
          matched: sources.length,
          readable: sources.filter((source) => source.excerpt).length,
          cited: sources.filter((source) => source.cited).length,
          restricted: sources.filter(
            (source) => source.readStatus === "restricted",
          ).length,
          artifacts: (row.artifacts || []).map((artifact) => artifact.kind),
        };
        results.push({
          ...metrics,
          input,
          greeting: row.greeting,
          artifacts: row.artifacts,
          evidence,
        });
        if (condition === "可读正文阳性对照") {
          assert.ok(metrics.cited > 0, "专家应该声明使用可读的验收卡");
          assert.ok(
            JSON.stringify({
              greeting: row.greeting,
              artifacts: row.artifacts,
            }).includes("KBT-731"),
            "最终产物应体现独特验收标记",
          );
        }
        console.log(JSON.stringify(metrics));
      } catch (error) {
        failures++;
        results.push({
          condition,
          case: index + 1,
          status: "failed",
          error: error instanceof Error ? error.message : "评测失败",
        });
        console.log(
          JSON.stringify({ condition, case: index + 1, status: "failed" }),
        );
      }
      await writeFile(
        path.join(directory, "report.json"),
        JSON.stringify(results, null, 2),
        { mode: 0o600 },
      );
    }
  }
} finally {
  await payload.destroy();
}
console.log(`评测报告：${path.join(directory, "report.json")}`);
if (failures) process.exitCode = 1;
