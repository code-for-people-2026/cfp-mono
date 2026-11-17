type FormResponseLike = {
  values?: Record<string, unknown>;
};

function hasStructuredAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (typeof value !== "object") return false;
  if ("unknown" in value) return value.unknown === true;
  if ("optionIds" in value) {
    const choice = value as { optionIds?: unknown; otherText?: unknown };
    const { optionIds, otherText } = choice;
    return (Array.isArray(optionIds) && optionIds.length > 0)
      || (typeof otherText === "string" && otherText.trim().length > 0);
  }
  return false;
}

export function formResponseGuidance(input: {
  formResponse?: FormResponseLike | undefined;
}): string | undefined {
  const response = input.formResponse;
  if (!response) return undefined;
  const entries = Object.entries(response.values ?? {});
  const answered = entries.filter(([, value]) => hasStructuredAnswer(value));
  const unanswered = entries.length - answered.length;
  const answeredFact = answered.length
    ? `${answered.length} 个字段收到有效答案`
    : "没有任何字段收到有效答案";
  const unansweredFact = unanswered
    ? `，${unanswered} 个字段未收到有效答案`
    : "";
  return `本轮结构化表单事实（以 formResponse.values 为唯一权威，不按输入文本关键词判断）：共 ${entries.length} 个字段，${answeredFact}${unansweredFact}。数值 0、布尔 false、非空 optionIds 和 unknown:true 都是有效答案；只要存在有效答案，不得把整份表单说成缺失或未提交。本轮回复必须先确认实际提交答案：有有效答案时先确认这些答案已被收到；没有任何有效答案时先确认本轮提交为空答案/跳过，而不是先提问。未收到有效答案只表示本轮没有该字段内容，不表示动机、拒绝、疲惫、能量或偏好，不得推断原因，也不得使用“空着也是一句话”“大约还不想挑”这类解释。若用户已在结构化值或本轮明确文字中说明原因，只能复述该明确说明，不得补充可能原因。可选字段的空答案按有效跳过处理，不是重新提问的许可。不要重复发布相同表单，也不要要求用户再次选择/填写，除非当前用户本轮明确要求编辑或重试；不要发明这种请求。若合适，可以提出一个实质上不同的新问题。`;
}
