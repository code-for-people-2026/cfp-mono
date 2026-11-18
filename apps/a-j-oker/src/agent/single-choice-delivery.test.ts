import { describe, expect, it } from "vitest";
import type { AJoker } from "../domain/contracts";
import { singleChoiceDeliveryError, singleOpenQuestionDeliveryError } from "./single-choice-delivery";

const multiField: AJoker = {
  aJoker: "可以慢慢填。",
  association: "普通练习表单",
  artifacts: [{
    kind: "form", id: "ordinary_form", title: "普通表单", description: "按需填写", submitLabel: "提交",
    fields: [
      { id: "mood", label: "感受", type: "select", required: false, allowOther: true, options: [{ id: "tired", label: "疲惫" }] },
      { id: "note", label: "补充", type: "longText", required: false },
    ],
  }],
};

describe("单题单选交付约束", () => {
  it("不限制普通多字段表单和后续回应", () => {
    expect(singleChoiceDeliveryError(false, multiField)).toBeUndefined();
  });

  it("限制明确请求中的补充输入和其他选项", () => {
    expect(singleChoiceDeliveryError(true, multiField)).toContain("只含一个 select 字段");
  });
});

describe("单题开放式交付约束", () => {
  it("拒绝当前轮明确只问一个开放式问题时的额外字段", () => {
    expect(singleOpenQuestionDeliveryError(true, multiField)).toContain("只含一个 text 或 longText 字段");
  });

  it.each(["text", "longText"] as const)("接受恰好一个 %s 字段", (type) => {
    expect(singleOpenQuestionDeliveryError(true, {
      aJoker: "可以慢慢写。",
      association: "按本轮要求只问一个开放式问题。",
      artifacts: [{
        kind: "form", id: "reflection", title: "先看这一点", description: "写下此刻最想梳理的部分",
        submitLabel: "继续", fields: [{ id: "answer", label: "如果暂时不替别人下结论，你确认发生了什么？", type, required: false }],
      }],
    })).toBeUndefined();
  });
});
