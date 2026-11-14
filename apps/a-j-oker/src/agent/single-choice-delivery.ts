import type { Greeting } from "../domain/contracts";

export function singleChoiceDeliveryError(required: boolean, reply: Greeting) {
  if (!required) return undefined;
  const artifacts = reply.artifacts ?? [];
  const form = artifacts.length === 1 && artifacts[0].kind === "form" ? artifacts[0] : undefined;
  const field = form?.fields.length === 1 ? form.fields[0] : undefined;
  if (!form || !field || field.type !== "select" || field.allowOther)
    return "回应尚未保存。用户明确要求一道可点击的单选题：请只保留一个 form 作品，且只含一个 select 字段，allowOther 必须为 false；不要附加文本输入、补充题或其他作品。";
  return undefined;
}
