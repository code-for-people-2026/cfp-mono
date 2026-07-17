import { jielongCanonicalInputSchema, jielongTextSchema } from "./api";
import type { JielongCanonicalInput } from "./types";

const headerPattern = /^(\d{4}-\d{2}-\d{2})\s+(午餐|晚餐)$/;
const rowPattern = /^(?:\d+[.、)）]\s*)?(.+?)\s+([1-9]\d*)份$/;

const invalidText = (): never => {
  throw new Error("接龙文本格式无效");
};

export function parseJielongText(text: string): JielongCanonicalInput {
  const source = jielongTextSchema.safeParse(text);
  if (!source.success) return invalidText();

  const nonBlankLines = source.data.split(/\r\n|\n|\r/)
    .map((value, index) => ({ lineNumber: index + 1, value: value.trim() }))
    .filter(({ value }) => value.length > 0);
  const [header, ...rows] = nonBlankLines;
  const headerMatch = headerPattern.exec(header?.value ?? "");
  if (!headerMatch || rows.length === 0) return invalidText();

  const lines = rows.map(({ lineNumber, value }) => {
    const match = rowPattern.exec(value);
    if (!match) return invalidText();
    return { lineNumber, displayName: match[1]!, quantity: Number(match[2]) };
  });

  return jielongCanonicalInputSchema.parse({
    target: { date: headerMatch[1], occasion: headerMatch[2] === "午餐" ? "lunch" : "dinner" },
    lines
  });
}

export const canonicalizeJielongInput = (input: JielongCanonicalInput): string =>
  JSON.stringify(jielongCanonicalInputSchema.parse(input));
