import type { Payload } from "payload";

// 菜谱库种子数据：从 sunmer-home/apps/weekly-menu 的 dishes.ts 迁移而来。
// 这是「数据上移」—— 原本写死在前端代码里的菜名，现在作为 CMS 初始数据。
// 运营之后通过 /admin 后台维护，不再改代码。

export type RecipeCategory = "big-meat" | "small-meat" | "vegetable";

export type RecipeSeed = {
  name: string;
  category: RecipeCategory;
};

const bigMeat = [
  "青椒鸡胸", "红烧鸡翅", "黑椒牛仔骨", "葱油鸡", "宫爆鸡丁", "酸汤肥牛",
  "毛蟹年糕", "椒盐手撕鸡", "米粉排骨", "酱鸭", "盐水鸭", "清炖萝卜牛腩",
  "水煮鱼", "干锅鸡翅", "干炒牛河", "土豆炖牛腩", "辣椒炒牛肉", "红烧肉",
  "可乐鸡翅", "糖醋排骨", "回锅肉", "黄焖鸡", "卤牛肉", "黑椒牛排",
  "清蒸鲈鱼", "辣子鸡", "蒜香排骨", "照烧鸡腿", "红烧狮子头", "叉烧肉",
  "清蒸鱼", "卤鸡腿", "可乐排骨", "三杯鸡", "糖醋里脊", "香酥鸡", "蜜汁鸡翅",
];

const smallMeat = [
  "农家小炒肉", "酱爆猪肝", "椒盐排条", "小锅米线", "番茄炒蛋", "西红柿鸡蛋汤",
  "丝瓜蛋汤", "木须肉", "鱼香肉丝", "麻婆豆腐", "酸辣鸡杂", "肉末茄子",
  "芹菜炒猪肝", "秋葵炒蛋", "黄瓜木耳炒蛋", "肉末蒸蛋", "虾仁滑蛋", "洋葱炒蛋",
  "韭菜炒蛋", "苦瓜炒蛋",
];

const vegetable = [
  "醋溜白菜", "酸辣土豆丝", "茭白炒香干", "干锅土豆", "炒茄子", "手撕茄子",
  "干煸四季豆", "手撕包菜", "蚝油生菜", "蒜蓉西兰花", "清炒油麦菜", "香菇青菜",
  "干锅花菜", "白灼菜心", "蒜蓉娃娃菜", "清炒菠菜", "红烧冬瓜", "地三鲜",
  "凉拌黄瓜", "虎皮青椒",
];

export const recipeSeed: RecipeSeed[] = [
  ...bigMeat.map((name) => ({ name, category: "big-meat" as const })),
  ...smallMeat.map((name) => ({ name, category: "small-meat" as const })),
  ...vegetable.map((name) => ({ name, category: "vegetable" as const })),
];

// 幂等导入：按菜名去重，已存在则跳过。和 seedSiteContent 一样受 PAYLOAD_SEED 保护。
export async function seedRecipes(payload: Payload) {
  for (const recipe of recipeSeed) {
    const existing = await payload.find({
      collection: "recipes",
      where: { name: { equals: recipe.name } },
      limit: 1,
    });
    if (existing.docs[0]) {
      continue;
    }
    await payload.create({
      collection: "recipes",
      data: { name: recipe.name, category: recipe.category, active: true },
    });
  }
  payload.logger.info(`Seeded ${recipeSeed.length} recipes into Payload.`);
}
