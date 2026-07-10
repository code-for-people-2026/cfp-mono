import type {
  ImportCommitInput,
  ImportPreviewResponse,
  Offering,
  OfferingCreate
} from "@cfp/kith-inn-v1-shared";

export class ImportTextError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export type ParsedImportLine =
  | { line: number; raw: string; parsed: OfferingCreate }
  | { line: number; raw: string; error: string };

const CATEGORY_ALIASES = new Map<string, OfferingCreate["category"]>([
  ["荤", "meat"],
  ["肉", "meat"],
  ["荤菜", "meat"],
  ["meat", "meat"],
  ["素", "veg"],
  ["素菜", "veg"],
  ["veg", "veg"],
  ["汤", "soup"],
  ["汤类", "soup"],
  ["soup", "soup"]
]);
const EXPLICIT_SEPARATOR = /[,，、|\t;；]/;

function invalid(line: number, raw: string, error: string): ParsedImportLine {
  return { line, raw, error };
}

function parseLine(raw: string, line: number): ParsedImportLine {
  const trimmed = raw.trim();
  const explicit = EXPLICIT_SEPARATOR.test(trimmed);
  const fields = explicit
    ? trimmed.split(EXPLICIT_SEPARATOR).map((field) => field.trim())
    : trimmed.split(/\s+/);
  if (explicit && fields.some((field) => field === "")) {
    return invalid(line, raw, "分隔符之间不能有空字段");
  }
  if (fields.length < 2) return invalid(line, raw, "每行需要菜名和分类");
  if (fields.length > 3) return invalid(line, raw, "每行最多包含菜名、主料和分类");
  const name = fields[0]!;
  const categoryText = fields.at(-1)!;
  const mainIngredient = fields.length === 3 ? fields[1]! : null;
  if (name.length > 80) return invalid(line, raw, "菜名不能超过 80 个字符");
  if (mainIngredient !== null && mainIngredient.length > 80) {
    return invalid(line, raw, "主料不能超过 80 个字符");
  }
  const category = CATEGORY_ALIASES.get(categoryText.toLowerCase());
  if (!category) return invalid(line, raw, `无法识别分类“${categoryText}”`);
  return { line, raw, parsed: { name, mainIngredient, category } };
}

export function parseImportText(text: string): ParsedImportLine[] {
  const rows = text.split(/\r?\n/)
    .map((raw, index) => ({ raw, line: index + 1 }))
    .filter(({ raw }) => raw.trim() !== "");
  if (rows.length > 50) throw new ImportTextError("too-many-import-rows", "一次最多导入 50 行");
  return rows.map(({ raw, line }) => parseLine(raw, line));
}

export function previewImport(text: string, existing: Offering[]): ImportPreviewResponse {
  const byName = new Map(existing.map((offering) => [offering.name, offering]));
  const seen = new Set<string>();
  const rows: ImportPreviewResponse["rows"] = parseImportText(text).map((row) => {
    if ("error" in row) return { ...row, status: "invalid" as const };
    if (seen.has(row.parsed.name)) {
      return { line: row.line, raw: row.raw, status: "invalid" as const, error: "本次文本内菜名重复" };
    }
    seen.add(row.parsed.name);
    const current = byName.get(row.parsed.name);
    return current
      ? {
          ...row,
          status: "conflict" as const,
          existingId: current.id,
          defaultAction: "skip" as const
        }
      : { ...row, status: "ready" as const, defaultAction: "create" as const };
  });
  return {
    rows,
    summary: {
      ready: rows.filter(({ status }) => status === "ready").length,
      conflict: rows.filter(({ status }) => status === "conflict").length,
      invalid: rows.filter(({ status }) => status === "invalid").length
    }
  };
}

export function conflictActionFor(
  line: number,
  conflicts: ImportCommitInput["conflicts"]
): "skip" | "overwrite" {
  return conflicts.some((conflict) => conflict.line === line) ? "overwrite" : "skip";
}
