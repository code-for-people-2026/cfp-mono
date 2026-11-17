import { describe, expect, it } from "vitest";
import {
  formResponseKey,
  formSubmissionStates,
  isFormOnlyInput,
} from "../src/chat/form-history";
import type { Input, Turn } from "../src/chat/model";

const formResponse = {
  turnId: 12,
  artifactId: "check_in",
  values: { answer: "保留回答" },
};

function turn(id: number, status: Turn["status"], input: Input): Turn {
  return {
    id,
    input,
    status,
    mode: "platform",
    greeting: null,
    error: null,
    association: null,
    approach: null,
    artifacts: null,
    model: null,
    createdAt: String(id),
  };
}

describe("AJ form history projection", () => {
  it("uses the server surface key", () => {
    expect(formResponseKey(formResponse)).toBe("turn_12_check_in");
  });

  it("identifies server-generated form-only user rows", () => {
    expect(
      isFormOnlyInput({
        text: "用户提交了表单",
        mediaIds: [],
        formResponse,
      }),
    ).toBe(true);
    expect(
      isFormOnlyInput({
        text: "用户提交了表单",
        mediaIds: [8],
        formResponse,
      }),
    ).toBe(false);
  });

  it("keeps failed or running answers editable and only locks confirmed answers", () => {
    const source = turn(12, "completed", {
      text: "",
      mediaIds: [],
    });
    const failedSubmission = turn(13, "failed", {
      text: "提交失败摘要",
      mediaIds: [],
      formResponse,
    });
    expect(formSubmissionStates([source, failedSubmission])).toEqual({
      responses: {},
      draftResponses: { turn_12_check_in: { answer: "保留回答" } },
    });

    const completed = turn(14, "completed", {
      text: "提交完成摘要",
      mediaIds: [],
      formResponse,
    });
    expect(formSubmissionStates([source, failedSubmission, completed])).toEqual({
      responses: { turn_12_check_in: { answer: "保留回答" } },
      draftResponses: {},
    });

    const laterRetry = turn(15, "running", {
      text: "提交中摘要",
      mediaIds: [],
      formResponse,
    });
    expect(formSubmissionStates([source, failedSubmission, completed, laterRetry]))
      .toEqual({
        responses: { turn_12_check_in: { answer: "保留回答" } },
        draftResponses: {},
      });
  });
});
