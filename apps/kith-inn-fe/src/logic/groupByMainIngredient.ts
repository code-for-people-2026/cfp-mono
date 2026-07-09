import type { Offering, OfferingCategory } from "@cfp/kith-inn-shared";

/** A group of offerings sharing a 菜品分类. */
export type OfferingGroup = {
  category: OfferingCategory | "uncategorized";
  label: string;
  offerings: Offering[];
};

const ORDER: Array<{ category: OfferingGroup["category"]; label: string }> = [
  { category: "meat", label: "荤" },
  { category: "veg", label: "素" },
  { category: "soup", label: "汤" },
  { category: "staple", label: "主食" },
  { category: "uncategorized", label: "未分类" },
];

/**
 * Group offerings by category in the kitchen page's default display order.
 * 主料 stays on each row; grouping by 主料 made the pool hard to scan.
 */
export function groupByCategory(offerings: Offering[]): OfferingGroup[] {
  const map = new Map<OfferingGroup["category"], Offering[]>();
  for (const offering of offerings) {
    const key = offering.category ?? "uncategorized";
    const list = map.get(key);
    if (list) {
      list.push(offering);
    } else {
      map.set(key, [offering]);
    }
  }
  return ORDER.flatMap(({ category, label }) => {
    const list = map.get(category);
    return list ? [{ category, label, offerings: list }] : [];
  });
}
