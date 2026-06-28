import type { Field } from "payload";

// Content lists live in `json` (jsonb) columns, not relational `array` child tables —
// see issue #72. Each builder carries an `admin.description` documenting the JSON shape
// so editors can edit the raw value in the admin. The data layer (lib/content) maps these
// json shapes to the typed contracts in lib/content/types.ts.

const JSON_ARRAY_HINT = "JSON 数组";

// { heading, intro } pair used by every homepage section header (plain fields — a `group`
// is inline columns, no child table, so these stay ordinary text fields).
export const sectionHeaderFields = (): Field[] => [
  { name: "heading", label: "区块标题", type: "text", required: true },
  { name: "intro", label: "区块导语", type: "textarea", required: true },
];

// JSON `string[]` — for plain bullet/paragraph lists (e.g. guide, points-as-strings).
export const stringsField = (name: string, label: string, hint = "每项一段文字"): Field => ({
  name,
  label,
  type: "json",
  defaultValue: [],
  admin: { description: `${JSON_ARRAY_HINT}，如 ["${hint}", "..."]` },
});

// JSON `{ title, body }[]` card list.
export const cardsField = (name: string, label: string): Field => ({
  name,
  label,
  type: "json",
  defaultValue: [],
  admin: { description: `${JSON_ARRAY_HINT}，每项 { "title": "...", "body": "..." }` },
});

// JSON document sections: `{ label?, heading, paragraphs: string[], points?: string[] }[]`.
export const sectionsField = (name: string, label: string): Field => ({
  name,
  label,
  type: "json",
  defaultValue: [],
  admin: {
    description:
      `${JSON_ARRAY_HINT}，每项 { "label"?: "...", "heading": "...", "paragraphs": ["..."], "points"?: ["..."] }`,
  },
});
