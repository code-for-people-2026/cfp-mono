import type { Offering } from "@cfp/kith-inn-shared";

/** A group of offerings sharing a 主料 (main ingredient). */
export type OfferingGroup = {
  mainIngredient: string;
  offerings: Offering[];
};

const FALLBACK_KEY = "其他";

/**
 * Group offerings by `mainIngredient` (the real de-dup axis, PRD §6.2: "肉就那
 * 几样"). Offerings without a mainIngredient fall under "其他". Pure + deterministic
 * — the kitchen page's 主料 sectioning.
 */
export function groupByMainIngredient(offerings: Offering[]): OfferingGroup[] {
  const map = new Map<string, Offering[]>();
  for (const offering of offerings) {
    const key = offering.mainIngredient ?? FALLBACK_KEY;
    const list = map.get(key);
    if (list) {
      list.push(offering);
    } else {
      map.set(key, [offering]);
    }
  }
  return [...map.entries()].map(([mainIngredient, list]) => ({
    mainIngredient,
    offerings: list,
  }));
}
