import { describe, expect, it } from "vitest";
import type { Greeting } from "../domain/contracts";
import { singleChoiceDeliveryError } from "./single-choice-delivery";

const multiField: Greeting = {
  greeting: "可以慢慢填。",
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
