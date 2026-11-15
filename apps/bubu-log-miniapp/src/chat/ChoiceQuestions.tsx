import { Button, Text, Textarea, View } from "@tarojs/components";
import type { ReplyChoice, ReplyQuestion } from "./contracts";
import { replyChoiceKey, type ChoiceAnswerRef } from "./drafts";

interface Props {
  questions: ReplyQuestion[];
  selected?: ChoiceAnswerRef;
  drafts: Record<string, string>;
  busy: boolean;
  onSelect(value: ChoiceAnswerRef): void;
  onDraft(value: ChoiceAnswerRef, text: string): void;
  onSubmit(question: ReplyQuestion, choice: ReplyChoice): void;
  onAttach(question: ReplyQuestion, choice: ReplyChoice): void;
  deferSubmit?: boolean;
}

const answerRef = (question: ReplyQuestion, choice: ReplyChoice): ChoiceAnswerRef => ({
  questionId: question.id, choiceId: choice.id, ...(question.origin.turnId ? { originTurnId: question.origin.turnId } : {}),
});
const same = (left: ChoiceAnswerRef | undefined, right: ChoiceAnswerRef) => !!left && left.questionId === right.questionId && left.choiceId === right.choiceId && left.originTurnId === right.originTurnId;

export function ChoiceQuestions({ questions, selected, drafts, busy, onSelect, onDraft, onSubmit, onAttach, deferSubmit = false }: Props) {
  if (!questions.length) return null;
  return <View className="bubu-chat-questions">
    {questions.map(question => {
      const choices = [...question.choices].sort((left, right) => Number(left.action.type === "custom") - Number(right.action.type === "custom"));
      return <View className="bubu-chat-question" key={`${question.origin.turnId ?? "pending"}:${question.id}`}>
      <Text className="bubu-chat-question-prompt">{question.prompt}</Text>
      <View className="bubu-chat-choice-row">
        {choices.map(choice => {
          const value = answerRef(question, choice), active = same(selected, value);
          return <Button key={choice.id} className={`bubu-chat-choice${active ? " selected" : ""}`} disabled={busy || undefined} onClick={() => {
            if (choice.action.type === "custom" || deferSubmit && choice.action.type !== "attach") onSelect(value);
            else if (choice.action.type === "attach") onAttach(question, choice);
            else onSubmit(question, choice);
          }}>{choice.label}</Button>;
        })}
      </View>
      {choices.map(choice => {
        if (choice.action.type !== "custom") return null;
        const value = answerRef(question, choice);
        if (!same(selected, value)) return null;
        const draft = drafts[replyChoiceKey(value)] ?? "";
        return <View className="bubu-chat-question-custom" key={choice.id}>
          <Textarea className="bubu-chat-question-input" value={draft} maxlength={6000} autoHeight disabled={busy} placeholder="填写自定义回答" onInput={event => onDraft(value, event.detail.value)} />
          {!deferSubmit && <Button className="bubu-chat-question-submit" disabled={busy || !draft.trim() || undefined} onClick={() => onSubmit(question, choice)}>发送回答</Button>}
        </View>;
      })}
    </View>})}
  </View>;
}
