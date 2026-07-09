import type { Offering, OfferingCreate, OfferingUpdate } from "@cfp/kith-inn-shared";
import { offeringDetailUrl, offeringsUrl } from "../services/api";

/** Minimal structural shape of Taro.request the CRUD fns need (kept loose so the
 *  page can pass `Taro.request` and tests a vi.fn — no Taro runtime import here). */
type ReqOptions = { url: string; method?: string; data?: unknown; header?: Record<string, string> };
type ReqResponse = { statusCode: number; data: unknown };
export type Req = (options: ReqOptions) => Promise<ReqResponse>;
export type OfferingImportItem = { name: string; mainIngredient?: string; category: OfferingCreate["category"] };
export type OfferingImportError = { line: number; text: string; reason: string };

const authHeader = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

/** Throw on non-2xx so the page's `.catch` shows the failure toast. */
const unwrap = async <T>(p: Promise<ReqResponse>, field: string): Promise<T> => {
  const res = await p;
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`offerings request failed: ${res.statusCode}`);
  return (res.data as Record<string, T>)[field];
};

/** POST /offerings — create a dish (name + mainIngredient + category). */
export async function createOffering(
  args: { token: string; name: string; mainIngredient?: string; category: OfferingCreate["category"] },
  req: Req,
): Promise<Offering> {
  return unwrap<Offering>(
    req({
      url: offeringsUrl(),
      method: "POST",
      data: { name: args.name, mainIngredient: args.mainIngredient, category: args.category },
      header: authHeader(args.token),
    }),
    "offering",
  );
}

/** PATCH /offerings/:id — edit name/mainIngredient/category (any subset). */
export async function updateOffering(
  args: { token: string; id: string | number; patch: OfferingUpdate },
  req: Req,
): Promise<Offering> {
  return unwrap<Offering>(
    req({ url: offeringDetailUrl(args.id), method: "PATCH", data: args.patch, header: authHeader(args.token) }),
    "offering",
  );
}

/** DELETE /offerings/:id — soft-deactivate (active=false). */
export async function deactivateOffering(args: { token: string; id: string | number }, req: Req): Promise<void> {
  const res = await req({ url: offeringDetailUrl(args.id), method: "DELETE", header: { Authorization: `Bearer ${args.token}` } });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`deactivate failed: ${res.statusCode}`);
}

/** POST /offerings/:id/restore — reactivate (active=true). */
export async function restoreOffering(args: { token: string; id: string | number }, req: Req): Promise<void> {
  const res = await req({
    url: `${offeringDetailUrl(args.id)}/restore`,
    method: "POST",
    header: { Authorization: `Bearer ${args.token}` },
  });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`restore failed: ${res.statusCode}`);
}

/** DELETE /offerings/:id/purge — hard-delete an inactive dish. */
export async function purgeOffering(args: { token: string; id: string | number }, req: Req): Promise<void> {
  const res = await req({ url: `${offeringDetailUrl(args.id)}/purge`, method: "DELETE", header: { Authorization: `Bearer ${args.token}` } });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`purge failed: ${res.statusCode}`);
}

/**
 * Split offerings into 菜品池 (active) / 已停用 (inactive). `active` defaults to
 * true (undefined → active); only explicit `active === false` is 已停用.
 */
export function partitionByActive(offerings: Offering[]): { active: Offering[]; inactive: Offering[] } {
  const active: Offering[] = [];
  const inactive: Offering[] = [];
  for (const o of offerings) {
    if (o.active === false) inactive.push(o);
    else active.push(o);
  }
  return { active, inactive };
}

const CATEGORY_BY_TEXT: Record<string, OfferingCreate["category"]> = {
  meat: "meat",
  "荤": "meat",
  "荤菜": "meat",
  "肉": "meat",
  veg: "veg",
  "素": "veg",
  "素菜": "veg",
  soup: "soup",
  "汤": "soup",
  "汤类": "soup",
  staple: "staple",
  "主食": "staple",
};

const cleanLine = (line: string): string => line.trim().replace(/^[-*•]\s*/, "").replace(/^\d+[.、]\s*/, "");

export function parseOfferingImport(text: string, existingNames: Set<string> = new Set()): { items: OfferingImportItem[]; errors: OfferingImportError[] } {
  const items: OfferingImportItem[] = [];
  const errors: OfferingImportError[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = cleanLine(raw);
    if (!line) return;
    const parts = line.split(/[\s,，、|]+/).filter(Boolean);
    const category = CATEGORY_BY_TEXT[parts[parts.length - 1]!];
    if (!category) {
      errors.push({ line: i + 1, text: raw, reason: "缺少分类（荤/素/汤/主食）" });
      return;
    }
    const name = parts.length > 1 ? parts[0] : "";
    if (!name) {
      errors.push({ line: i + 1, text: raw, reason: "缺少菜名" });
      return;
    }
    if (existingNames.has(name) || seen.has(name)) {
      errors.push({ line: i + 1, text: raw, reason: "菜名重复，已跳过" });
      return;
    }
    seen.add(name);
    items.push({ name, mainIngredient: parts.length > 2 ? parts[1] : undefined, category });
  });
  return { items, errors };
}
