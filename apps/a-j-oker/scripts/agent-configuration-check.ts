import { syntheticTextReview } from "./synthetic-text-review";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const dir = await mkdtemp(path.join(tmpdir(), "a-j-oker-config-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/test.db`;
process.env.PAYLOAD_SECRET = "configuration-check-only-secret";
process.env.HELLO_ADMIN_BOOTSTRAP = "false";
const { cms } = await import("../src/cms/client");
const { seedAgents } = await import("../src/cms/seed");
const { renameAgentBrand } = await import("../src/cms/rename-brand");
const { loadAgentConfiguration } = await import("../src/agent/configuration");
const { readTurnKnowledge } = await import("../src/agent/knowledge-evidence");
const { decryptKnowledgeSecret } = await import("../src/cms/secret");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { runGreeting } = await import("../src/agent/runtime");
const { ScriptedModel } = await import("./scripted-model");
const payload = await cms();
try {
  await assert.rejects(loadAgentConfiguration(payload), /seed/);
  assert.deepEqual(await seedAgents(payload), { created: 9, preserved: 0 });
  const admin = {
    ...(await payload.create({
      collection: "admins",
      data: { role: "reviewer",
        email: "configuration@example.test",
        password: "fixture-password-long",
      },
      context: { helloAdminBootstrap: true },
    })),
    collection: "admins" as const,
  };
  const adminOptions = { overrideAccess: false, user: admin };
  for (const collection of ["agent-configs", "knowledge-bases"] as const) {
    await assert.rejects(payload.find({ collection, overrideAccess: false }));
  }
  await assert.rejects(
    payload.create({
      collection: "agent-configs",
      overrideAccess: false,
      data: { name: "guest", key: "cbt", enabled: true, prompt: "guest" },
    }),
  );
  await assert.rejects(
    payload.create({
      collection: "knowledge-bases",
      overrideAccess: false,
      data: { name: "guest", enabled: true, provider: "inline" },
    }),
  );
  const cbt = (
    await payload.find({
      collection: "agent-configs",
      where: { key: { equals: "cbt" } },
      ...adminOptions,
    })
  ).docs[0];
  const library = await payload.create({
    collection: "knowledge-bases",
    ...adminOptions,
    data: {
      name: "CBT 参考",
      provider: "inline",
      enabled: true,
      content: "测试参考事实：先记录原话，再区分猜测和证据。",
    },
  });
  await payload.update({
    collection: "agent-configs",
    id: cbt.id,
    ...adminOptions,
    data: {
      prompt: "管理员定制提示词：优先承接用户已填的记录。",
      enabled: false,
      knowledgeBases: [library.id],
    },
  });
  assert.deepEqual(await seedAgents(payload), { created: 0, preserved: 9 });
  let config = await loadAgentConfiguration(payload);
  assert.ok(!config.specialists.some((spec) => spec.approach === "cbt"));
  await payload.update({
    collection: "agent-configs",
    id: cbt.id,
    ...adminOptions,
    data: { enabled: true },
  });
  config = await loadAgentConfiguration(payload);
  const cbtConfig = config.specialists.find((spec) => spec.approach === "cbt")!;
  assert.equal(cbtConfig.prompt, "管理员定制提示词：优先承接用户已填的记录。");
  assert.equal(
    (await cbtConfig.knowledge!("认知记录", new AbortController().signal))
      .sources[0].excerpt,
    library.content,
  );
  const main = (
    await payload.find({
      collection: "agent-configs",
      where: { key: { equals: "coordinator" } },
      ...adminOptions,
    })
  ).docs[0];
  await assert.rejects(
    payload.update({
      collection: "agent-configs",
      id: main.id,
      ...adminOptions,
      data: { enabled: false },
    }),
  );
  await assert.rejects(
    payload.delete({
      collection: "agent-configs",
      id: main.id,
      ...adminOptions,
    }),
  );
  await assert.rejects(
    payload.update({
      collection: "agent-configs",
      id: cbt.id,
      ...adminOptions,
      data: { key: "act" },
    }),
  );
  await assert.rejects(
    payload.update({
      collection: "agent-configs",
      id: cbt.id,
      overrideAccess: false,
      data: { prompt: "guest overwrite" },
    }),
  );

  const apiKey = "fixture-ima-private-key";
  const ima = await payload.create({
    collection: "knowledge-bases",
    ...adminOptions,
    data: {
      name: "ima 凭证验证",
      enabled: true,
      provider: "ima",
      clientId: "client-fixture",
      knowledgeBaseId: "kb-fixture",
      apiKey,
    },
  });
  assert.ok(!JSON.stringify(ima).includes(apiKey));
  assert.ok(!ima.encryptedApiKey);
  assert.equal(ima.hasApiKey, true);
  const stored = () =>
    payload.findByID({
      collection: "knowledge-bases",
      id: ima.id,
      overrideAccess: true,
      context: { helloKnowledgeSecrets: true },
    });
  const initial = await stored();
  assert.equal(
    decryptKnowledgeSecret(initial.encryptedApiKey!, payload.secret),
    apiKey,
  );
  await payload.update({
    collection: "knowledge-bases",
    id: ima.id,
    ...adminOptions,
    data: {
      name: "仅改名字",
      apiKey: "",
      encryptedApiKey: "attacker-ciphertext",
    },
  });
  assert.equal(
    (await stored()).encryptedApiKey,
    initial.encryptedApiKey,
    "空白密钥保留，不能直接写密文",
  );
  await payload.update({
    collection: "knowledge-bases",
    id: ima.id,
    ...adminOptions,
    data: { apiKey: "replacement-fixture" },
  });
  assert.equal(
    decryptKnowledgeSecret((await stored()).encryptedApiKey!, payload.secret),
    "replacement-fixture",
  );
  await payload.update({
    collection: "knowledge-bases",
    id: ima.id,
    ...adminOptions,
    data: { clearApiKey: true },
  });
  assert.ok(!(await stored()).encryptedApiKey);
  await assert.rejects(
    payload.findByID({
      collection: "knowledge-bases",
      id: ima.id,
      overrideAccess: false,
    }),
  );

  await payload.update({
    collection: "knowledge-bases",
    id: ima.id,
    ...adminOptions,
    data: { apiKey: "runtime-ima-fixture" },
  });
  await payload.update({
    collection: "agent-configs",
    id: cbt.id,
    ...adminOptions,
    data: { knowledgeBases: [library.id, ima.id] },
  });
  const originalFetch = globalThis.fetch;
  let searches = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      String(url),
      "https://ima.qq.com/openapi/wiki/v1/search_knowledge",
    );
    assert.equal(
      new Headers(init?.headers).get("ima-openapi-apikey"),
      "runtime-ima-fixture",
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      query: "认知重构",
      cursor: "",
      knowledge_base_id: "kb-fixture",
    });
    searches++;
    return Response.json({
      code: 0,
      data: {
        info_list: [
          {
            media_id: "reference-fixture",
            title: "ima 引用",
            highlight_content: "ima 测试片段：核对支持与不支持想法的证据。",
          },
        ],
      },
    });
  };
  try {
    const model = new ScriptedModel([
      {
        greeting: "先把事实与猜测分开。",
        association: "来自用户填写",
        approach: "cbt",
      },
    ]);
    const repo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
    const service = new GreetingService(repo, (request) =>
      runGreeting(request, model), undefined, undefined, { moderate: syntheticTextReview }
    );
    const session = await service.createSession("配置集成检查");
    process.env.DEEPSEEK_API_KEY = "fixture-platform-key";
    const row = await service.generateGreeting({
      sessionId: session.id,
      requestId: randomUUID(),
      mode: "platform",
      input: { text: "请用 CBT 帮我整理想法" },
    });
    assert.equal(row.status, "completed");
    const requests = JSON.stringify(
      model.requests.map((request) => ({
        contents: request.contents,
        instruction: request.config?.systemInstruction,
      })),
    );
    assert.ok(requests.includes("管理员定制提示词"));
    assert.ok(requests.includes("测试参考事实"));
    assert.ok(!requests.includes(apiKey));
    assert.ok(!requests.includes("runtime-ima-fixture"));
    assert.ok(requests.includes("ima 测试片段"));
    assert.equal(searches, 1);
    const events = JSON.stringify(await repo.all("adk-sessions"));
    assert.ok(!events.includes("runtime-ima-fixture"));
    assert.ok(events.includes("reference-fixture"));
    assert.ok(!events.includes("请用 CBT 帮我整理想法"), "聊天正文不应复制进执行日志");
    const evidence = await readTurnKnowledge(payload, row.id);
    assert.ok(evidence.some((expert) => expert.approach === "cbt" && expert.sources.some((source) => source.sourceId === "reference-fixture" && source.referenceId === "ref_1" && source.excerpt.includes("ima 测试片段"))), "脱敏保存后管理员仍可读取本轮知识依据和原始资料标识");
    globalThis.fetch = async () => {
      throw new Error("vendor error: runtime-ima-fixture");
    };
    const knowledge = await (
      await loadAgentConfiguration(payload)
    ).specialists.find((spec) => spec.approach === "cbt")!.knowledge!(
      "认知重构",
      new AbortController().signal,
    );
    assert.ok(knowledge.notices.some((notice) => notice.includes("读取失败")));
    assert.ok(!JSON.stringify(knowledge).includes("runtime-ima-fixture"));
  } finally {
    globalThis.fetch = originalFetch;
  }
  await payload.update({
    collection: "agent-configs",
    id: cbt.id,
    ...adminOptions,
    data: { knowledgeBases: [library.id] },
  });
  await payload.update({
    collection: "knowledge-bases",
    id: library.id,
    ...adminOptions,
    data: { enabled: false },
  });
  assert.equal(
    (await loadAgentConfiguration(payload)).specialists.find(
      (spec) => spec.approach === "cbt",
    )?.knowledge,
    undefined,
  );
  // Simulate an existing installation with administrator edits and bindings.
  await payload.update({
    collection: "agent-configs",
    id: cbt.id,
    ...adminOptions,
    data: {
      name: "阿 Q 先生 · 管理员的 CBT",
      prompt: "你是阿 J 的 CBT 助手。管理员定制：优先承接用户已填的记录。保留阿Q正传文学参考。",
      enabled: false,
    },
  });
  await payload.update({
    collection: "agent-configs",
    id: main.id,
    ...adminOptions,
    data: {
      name: "阿 Q + · 主 Agent",
      prompt: "你是「阿 Q +」的 AI 搭子，自称「阿 Q +」。管理员规则保留。",
    },
  });
  const snapshot = async () => ({
    agents: (
      await payload.find({
        collection: "agent-configs",
        pagination: false,
        depth: 0,
      })
    ).docs,
    libraries: (
      await payload.find({
        collection: "knowledge-bases",
        pagination: false,
        depth: 0,
        context: { helloKnowledgeSecrets: true },
      })
    ).docs,
    greetings: (
      await payload.find({
        collection: "greetings",
        pagination: false,
        depth: 0,
      })
    ).docs,
    sessions: (
      await payload.find({
        collection: "adk-sessions",
        pagination: false,
        depth: 0,
      })
    ).docs,
  });
  const beforeRename = await snapshot();
  assert.deepEqual(await renameAgentBrand(payload), {
    updated: 2,
    preserved: 7,
  });
  const afterRename = await snapshot();
  assert.deepEqual(afterRename.libraries, beforeRename.libraries);
  assert.deepEqual(afterRename.greetings, beforeRename.greetings);
  assert.deepEqual(afterRename.sessions, beforeRename.sessions);
  for (const previous of beforeRename.agents) {
    const current = afterRename.agents.find(
      (agent) => agent.id === previous.id,
    )!;
    if (previous.id === cbt.id || previous.id === main.id) {
      const expected =
        previous.id === cbt.id
          ? {
              name: "阿 J 先生 · 管理员的 CBT",
              prompt:
                "你是阿 J 先生的 CBT 助手。管理员定制：优先承接用户已填的记录。保留阿Q正传文学参考。",
            }
          : {
              name: "阿 J 先生 · 主 Agent",
              prompt:
                "你是「阿 J 先生」的 AI 搭子，自称「阿 J 先生」。管理员规则保留。",
            };
      assert.deepEqual(current, {
        ...previous,
        ...expected,
        updatedAt: current.updatedAt,
      });
    } else assert.deepEqual(current, previous);
  }
  assert.deepEqual(await renameAgentBrand(payload), {
    updated: 0,
    preserved: 9,
  });
  await seedAgents(payload);
  assert.deepEqual(
    await snapshot(),
    afterRename,
    "重复改名和 seed 不再写入配置或重置管理员编辑",
  );
  console.log(
    "✓ 改名只更新配置中的品牌文字，保留定制提示词、停用状态、知识绑定、密钥和历史；重复执行无写入。",
  );
  console.log(
    "✓ seed 幂等保留配置；管理员权限；主 Agent 防停用；提示词与知识绑定实际进入 ADK；停用下一轮生效；ima 密钥加密、隐藏、空白保留、更新与清除通过。",
  );
} finally {
  await payload.destroy();
}
