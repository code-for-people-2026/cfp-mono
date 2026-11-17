import { describe, expect, it } from "vitest";
import { formResponseGuidance } from "./form-response-guidance";

describe("结构化表单回应指导", () => {
  it("空选择只说明缺失，不解释动机", () => {
    const guidance = formResponseGuidance({
      formResponse: { values: { choice: { optionIds: [] } } },
    });
    expect(guidance).toContain("没有任何字段收到有效答案");
    expect(guidance).toContain("只表示本轮没有该字段内容");
    expect(guidance).toContain("不表示动机、拒绝、疲惫、能量或偏好");
    expect(guidance).toContain("不得推断原因");
    expect(guidance).toContain("只能复述该明确说明");
  });

  it("空提交和已答提交都要求先确认结果且不得重复发同一表单", () => {
    const emptySubmission = formResponseGuidance({
      formResponse: { values: { choice: { optionIds: [] } } },
    });
    const answeredSubmission = formResponseGuidance({
      formResponse: { values: { choice: { optionIds: ["stay"] } } },
    });

    for (const guidance of [emptySubmission, answeredSubmission]) {
      expect(guidance).toContain("本轮回复必须先确认实际提交答案");
      expect(guidance).toContain("有有效答案时先确认这些答案已被收到");
      expect(guidance).toContain("没有任何有效答案时先确认本轮提交为空答案/跳过");
      expect(guidance).toContain("可选字段的空答案按有效跳过处理，不是重新提问的许可");
      expect(guidance).toContain("不要重复发布相同表单，也不要要求用户再次选择/填写");
      expect(guidance).toContain("除非当前用户本轮明确要求编辑或重试；不要发明这种请求");
      expect(guidance).toContain("若合适，可以提出一个实质上不同的新问题");
    }
  });

  it("0、false 和已选选项是有效答案，不能把整份表单当缺失", () => {
    const guidance = formResponseGuidance({
      formResponse: {
        values: {
          intensity: 0,
          agreed: false,
          choice: { optionIds: ["stay"] },
          skipped: { optionIds: [] },
        },
      },
    });
    expect(guidance).toContain("4 个字段");
    expect(guidance).toContain("3 个字段收到有效答案");
    expect(guidance).toContain("1 个字段未收到有效答案");
    expect(guidance).toContain("只要存在有效答案，不得把整份表单说成缺失或未提交");
    expect(guidance).not.toContain("没有任何字段收到有效答案");
  });

  it("没有表单回应时不注入业务指导", () => {
    expect(formResponseGuidance({})).toBeUndefined();
    expect(formResponseGuidance({ formResponse: undefined })).toBeUndefined();
  });
});
