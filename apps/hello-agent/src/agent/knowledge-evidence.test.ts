import { describe, expect, it } from "vitest";
import { evidenceFromSnapshot } from "./knowledge-evidence";
const source = {
  library: "CBT 资料",
  title: "思维记录",
  excerpt: "检查证据",
  referenceId: "ref_1",
  readStatus: "document",
};
describe("逐轮知识依据", () => {
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
