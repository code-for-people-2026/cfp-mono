import { DishBatchInputSchema, type Category, type DishInput } from "@cfp/kith-inn-contracts";

export const labels: Record<Category, string> = { meat: "荤", vegetable: "素", soup: "汤" };
const next: Record<Category, Category> = { meat: "vegetable", vegetable: "soup", soup: "meat" };
const normalize = (name: string) => name.trim().normalize("NFC");

export function cycleCategory(category: Category): Category {
  return next[category];
}

export function previewDishes(source: string, previous: DishInput[] = []): DishInput[] {
  const names = source.split(/\r\n?|\n/).map(normalize).filter(Boolean);
  if (!names.length) throw new Error("请至少输入一道菜，每行一个菜名。");
  if (names.length > 200) throw new Error("每次最多录入 200 道菜，请分批录入。");
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const existing = new Map(previous.map(({ name, category }) => [normalize(name), category]));
  const items = names.map((name): DishInput => {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
    const suggestion = /汤|羹/.test(name) ? "soup"
      : /肉|排骨|牛|羊|鸡|鸭|鹅|鱼|虾|蟹|丸|腊肠/.test(name) ? "meat" : "vegetable";
    return { name, category: existing.get(name) ?? suggestion };
  });
  if (duplicates.size) throw new Error(`菜名重复：${[...duplicates].join("、")}。请修改后重试。`);
  const parsed = DishBatchInputSchema.safeParse({ items });
  if (!parsed.success) throw new Error("菜名须为 1～60 个字符且不含控制字符或分隔符，分类须为荤、素或汤。");
  return parsed.data.items;
}
