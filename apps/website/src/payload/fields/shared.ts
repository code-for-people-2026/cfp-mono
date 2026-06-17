import type { Field } from "payload";

// Reusable field builders for the structured document/marketing content.

export const paragraphsField = (name = "paragraphs", label = "段落"): Field => ({
  name,
  label,
  type: "array",
  labels: { singular: "段落", plural: "段落" },
  fields: [{ name: "text", label: "文字", type: "textarea", required: true }],
});

export const pointsField = (name = "points", label = "要点"): Field => ({
  name,
  label,
  type: "array",
  labels: { singular: "要点", plural: "要点" },
  fields: [{ name: "text", label: "文字", type: "text", required: true }],
});

export const sectionsField = (name: string, label: string): Field => ({
  name,
  label,
  type: "array",
  fields: [
    { name: "label", label: "编号", type: "text" },
    { name: "heading", label: "小标题", type: "text", required: true },
    paragraphsField(),
    pointsField(),
  ],
});

// A simple { title, body } card list, with optional extra fields (e.g. tags).
export const cardsField = (name: string, label: string, extra: Field[] = []): Field => ({
  name,
  label,
  type: "array",
  fields: [
    { name: "title", label: "标题", type: "text", required: true },
    { name: "body", label: "正文", type: "textarea", required: true },
    ...extra,
  ],
});

// { heading, intro } pair used by every homepage section header.
export const sectionHeaderFields = (): Field[] => [
  { name: "heading", label: "区块标题", type: "text", required: true },
  { name: "intro", label: "区块导语", type: "textarea", required: true },
];
