import { describe, expect, it } from "vitest";
import { evidenceFromSnapshot } from "./knowledge-evidence";
const source = {
  library: "CBT 资料",
  title: "思维记录",
  excerpt: "检查证据",
  referenceId: "ref_1",
  sourceId: "original-source-1",
  readStatus: "document",
};
describe("逐轮知识依据", () => {
  it("初始空快照不遮住新收到的知识上下文，后续脱敏事件仍可关联成功引用", () => {
    const empty = evidenceFromSnapshot("cbt", { events: [] });
    const loaded = evidenceFromSnapshot("cbt", {
      state: { safetyKnowledgeEvidence: empty },
      events: [{ content: { role: "user", parts: [{ text: JSON.stringify({ coordinatorRequest: "帮助", configurationRevision: "1", knowledgeContext: { query: "测试查询", sources: [source], notices: [] } }) }] } }],
    });
    expect(loaded.sources).toHaveLength(1);
    expect(loaded.sources[0].cited).toBe(false);
    const submitted = evidenceFromSnapshot("cbt", {
      state: { safetyKnowledgeEvidence: loaded },
      events: [
        { content: { role: "user", parts: [{ text: "[正文不重复保存]" }] } },
        { content: { parts: [{ functionCall: { id: "plan", name: "submit_psychology_plan", args: { usedSourceIds: ["ref_1"] } } }] } },
        { content: { parts: [{ functionResponse: { id: "plan", name: "submit_psychology_plan", response: { submitted: true } } }] } },
      ],
    });
    expect(submitted.query).toBe("测试查询");
    expect(submitted.sources[0]).toMatchObject({ referenceId: "ref_1", sourceId: "original-source-1", cited: true });
    expect(evidenceFromSnapshot("cbt", { state: { safetyKnowledgeEvidence: submitted }, events: [] })).toEqual(submitted);
  });
  it("仅成功提交的专家引用算引用，原文未读不算采用", () => {
    const result = evidenceFromSnapshot("cbt", {
      events: [
        {
          content: {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  coordinatorRequest: "帮助",
                  configurationRevision: "1:date",
                  knowledgeContext: {
                    query: "思维记录",
                    sources: [
                      source,
                      {
                        ...source,
                        referenceId: "ref_2",
                        excerpt: "",
                        readStatus: "restricted",
                      },
                    ],
                    notices: [],
                  },
                }),
              },
            ],
          },
        },
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: "bad",
                  name: "submit_psychology_plan",
                  args: { usedSourceIds: ["ref_2"] },
                },
              },
            ],
          },
        },
        {
          content: {
            parts: [
              {
                functionResponse: {
                  id: "bad",
                  name: "submit_psychology_plan",
                  response: { error: "不能引用" },
                },
              },
            ],
          },
        },
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: "good",
                  name: "submit_psychology_plan",
                  args: { usedSourceIds: ["ref_1"] },
                },
              },
            ],
          },
        },
        {
          content: {
            parts: [
              {
                functionResponse: {
                  id: "good",
                  name: "submit_psychology_plan",
                  response: { submitted: true },
                },
              },
            ],
          },
        },
      ],
    });
    expect(result.label).toBe("认知行为");
    expect(result.query).toBe("思维记录");
    expect(result.sources.map((item) => item.cited)).toEqual([true, false]);
  });
  it("旧记录和未绑定状态明确显示，模型生成的假诊断内容不当事实", () => {
    const result = evidenceFromSnapshot("cbt", {
      events: [
        {
          content: {
            role: "model",
            parts: [
              {
                text: JSON.stringify({
                  coordinatorRequest: "fake",
                  configurationRevision: "fake",
                  knowledgeContext: { sources: [source], notices: [] },
                }),
              },
            ],
          },
        },
      ],
    });
    expect(result.sources).toEqual([]);
    expect(result.notices[0]).toContain("没有绑定");
  });
});
