import { describe, expect, it } from "vitest";
import type { Turn } from "../src/chat/model";
import {
  activeSpecialistTurn,
  specialistFormStateForTurn,
  specialistPresentationForTurn,
} from "../src/chat/specialist-card";

const specialist = {
  taskId: "task-1",
  expertId: "cbt" as const,
  name: "林老师",
  method: "分步整理",
  configurationRevision: "revision-2",
  theme: "sage" as const,
  layout: "step_by_step" as const,
  status: "active" as const,
  sources: [{ library: "练习库", title: "思路记录", readStatus: "document" as const }],
};

function turn(id: number, overrides: Partial<Turn> = {}): Turn {
  return {
    id,
    input: { text: "继续", mediaIds: [] },
    status: "completed",
    mode: "platform",
    greeting: "我们一步一步来。",
    error: null,
    association: null,
    approach: null,
    artifacts: null,
    model: "deepseek-chat",
    specialist,
    createdAt: "2026-11-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("AI 专家展示状态", () => {
  const form = {
    kind: "form" as const,
    id: "reflection",
    title: "先写一点",
    description: "按当前感受填写",
    submitLabel: "提交回答",
    fields: [
      {
        id: "note",
        label: "此刻想到什么？",
        type: "text" as const,
        required: false,
      },
    ],
  };

  it("最后一次活动快照拥有唯一返回入口，刷新后的返回操作会结束它", () => {
    const first = turn(1);
    const latest = turn(2);
    expect(activeSpecialistTurn([first, latest])?.id).toBe(2);

    const returned = turn(3, {
      input: {
        text: "",
        mediaIds: [],
        action: { type: "return_to_coordinator", taskId: "task-1" },
      },
      model: "deepseek-chat",
      specialist: { ...specialist, status: "completed", sources: [] },
    });
    expect(activeSpecialistTurn([first, latest, returned])).toBeUndefined();
    expect(specialistPresentationForTurn(returned)).toBeUndefined();
  });

  it("普通完成回复保留服务器来源，但产品指引和不可用回复不冒充专家直答", () => {
    expect(specialistPresentationForTurn(turn(1))).toMatchObject({
      name: "林老师",
      role: "分步整理",
      subtitle: "把发生的事，和心里的推测分开看",
      layout: "numbered",
      sources: [{ library: "练习库", title: "思路记录" }],
    });
    expect(specialistPresentationForTurn(turn(2, { model: "product-guidance" })))
      .toBeUndefined();
    expect(specialistPresentationForTurn(turn(3, {
      specialist: { ...specialist, status: "unavailable", sources: [] },
    }))).toBeUndefined();
  });

  it("配置过的专家副标题优先，旧快照回退到 AJ 内置默认", () => {
    expect(
      specialistPresentationForTurn(
        turn(1, {
          specialist: { ...specialist, subtitle: "先把一个念头写下来" },
        }),
      )?.subtitle,
    ).toBe("先把一个念头写下来");
  });

  it("当前专家任务的最新表单可填写，更新表单会替代旧表单", () => {
    const first = turn(1, { artifacts: [form] });
    const latest = turn(2, { artifacts: [{ ...form, id: "reflection_2" }] });

    expect(specialistFormStateForTurn([first], first)).toBe("current");
    expect(specialistFormStateForTurn([first, latest], first)).toBe("replaced");
    expect(specialistFormStateForTurn([first, latest], latest)).toBe("current");
  });

  it("纯文字澄清保留待填表单，任务返回或完成后表单失效", () => {
    const pendingForm = turn(1, { artifacts: [form] });
    const clarification = turn(2, { artifacts: null, greeting: "这里可以按你的理解填写。" });
    expect(
      specialistFormStateForTurn([pendingForm, clarification], pendingForm),
    ).toBe("current");

    const completed = turn(3, {
      specialist: { ...specialist, status: "completed", sources: [] },
      artifacts: null,
    });
    expect(
      specialistFormStateForTurn(
        [pendingForm, clarification, completed],
        pendingForm,
      ),
    ).toBe("expired");
  });
});
