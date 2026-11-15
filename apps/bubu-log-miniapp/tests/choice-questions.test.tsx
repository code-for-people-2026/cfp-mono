import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tarojs/components", () => ({ Button: "button", Text: "text", Textarea: "textarea", View: "view" }));

import { ChoiceQuestions } from "../src/chat/ChoiceQuestions";
import type { ReplyQuestion } from "../src/chat/contracts";
import { replyChoiceKey, type ChoiceAnswerRef } from "../src/chat/drafts";

const question: ReplyQuestion = {
  id: "clarify-1", prompt: "这次是哪一种？", origin: { kind: "turn", turnId: "turn-1", selectedEventId: "event-1" },
  choices: [
    { id: "left", label: "第一种", action: { type: "reply", text: "是第一种" } },
    { id: "right", label: "第二种", action: { type: "reply", text: "是第二种" } },
    { id: "photo", label: "补照片", action: { type: "attach", text: "补充照片" } },
    { id: "custom", label: "自定义", action: { type: "custom" } },
  ],
};

describe("structured chat choice questions", () => {
  it("posts concrete buttons immediately and opens custom input only after custom is selected", () => {
    const onSelect = vi.fn(), onDraft = vi.fn(), onSubmit = vi.fn(), onAttach = vi.fn();
    const selected: { current?: ChoiceAnswerRef } = {};
    const render = () => <ChoiceQuestions questions={[question]} selected={selected.current} drafts={selected.current ? { [replyChoiceKey(selected.current)]: "自己的答案" } : {}} busy={false}
      onSelect={onSelect} onDraft={onDraft} onSubmit={onSubmit} onAttach={onAttach} />;
    const root = create(render());
    expect(root.root.findAllByType("textarea")).toHaveLength(0);
    const buttons = root.root.findAllByType("button");
    act(() => buttons.find(button => button.children.includes("第一种"))!.props.onClick());
    expect(onSubmit).toHaveBeenCalledWith(question, question.choices[0]);
    act(() => buttons.find(button => button.children.includes("补照片"))!.props.onClick());
    expect(onAttach).toHaveBeenCalledWith(question, question.choices[2]);
    act(() => buttons.find(button => button.children.includes("自定义"))!.props.onClick());
    selected.current = onSelect.mock.calls[0]![0];
    act(() => root.update(render()));
    const input = root.root.findByType("textarea");
    expect(input.props.value).toBe("自己的答案");
    act(() => input.props.onInput({ detail: { value: "修改后的答案" } }));
    expect(onDraft).toHaveBeenCalledWith(selected.current, "修改后的答案");
  });
});
