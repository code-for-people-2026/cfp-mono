/**
 * 桃子的真实群接龙样本（eval ground truth）。`raw` 是粘贴原文，`expected` 是人工
 * 标注的正确解析（名字+份数+餐次）。`例` 行是格式示例、不是订单——已排除。
 * 顾客名按原文存（eval 比较前对 predicted/expected 都做 normalize）。
 *
 * 难点覆盖：中文份数"一份"、餐次位置不定（8份晚餐/晚餐一份/晚餐1份）、
 * 名字变体（lily/Catherine chen/Sissi-CC/秀）、一段含午+晚两菜单、菜单行 vs 订单行。
 */
export type ExpectedItem = { customerName: string; quantity: number; occasion: "lunch" | "dinner" };
export type JielongSample = { id: string; raw: string; expected: ExpectedItem[] };

export const jielongSamples: JielongSample[] = [
  {
    id: "0608-mon-dinner",
    raw: `#接龙
6.8号星期一晚餐预定接龙（30元）
  1.凉拌牛肉
  2.客家酿豆腐
  3.炒青瓜
  4.炒青菜
  5.冬瓜汤
例 桃子  1份午餐晚餐

1. 桃子   8份晚餐
2. lily   1份晚餐
3. 苏月兰 晚餐一份`,
    expected: [
      { customerName: "桃子", quantity: 8, occasion: "dinner" },
      { customerName: "lily", quantity: 1, occasion: "dinner" },
      { customerName: "苏月兰", quantity: 1, occasion: "dinner" },
    ],
  },
  {
    id: "0609-tue-lunch-dinner",
    raw: `#接龙
6.9号星期二午餐预定接龙（30元）
   1.红烧鲈鱼
   2.小炒肉
   3.炒茄子
   4.炒青菜
   5.冬瓜汤
6.9号星期二晚餐预定接龙（30元）
   1.炒鸡肉丁
   2.炒肉卷
   3.炒葫芦瓜
   4.炒青菜
   5.冬瓜汤
例 桃子   1份午餐晚餐

1. 桃子   6份晚餐
2. 王燕萍 一份午餐
3. 小柠檬 一份午餐
4. 桃子    1份午餐
5. reni 午餐一份
6. 李湘 午餐一份
7. 大龙猫 午餐一份
8. 苏月兰 晚餐一份`,
    expected: [
      { customerName: "桃子", quantity: 6, occasion: "dinner" },
      { customerName: "王燕萍", quantity: 1, occasion: "lunch" },
      { customerName: "小柠檬", quantity: 1, occasion: "lunch" },
      { customerName: "桃子", quantity: 1, occasion: "lunch" },
      { customerName: "reni", quantity: 1, occasion: "lunch" },
      { customerName: "李湘", quantity: 1, occasion: "lunch" },
      { customerName: "大龙猫", quantity: 1, occasion: "lunch" },
      { customerName: "苏月兰", quantity: 1, occasion: "dinner" },
    ],
  },
  {
    id: "0610-wed-lunch-dinner",
    raw: `#接龙
6.10号星期三午餐预定接龙（30元）
   1.红烧猪脚
   2.煎鸡中翅
   3.炒豆角
   4.炒青菜
6.10号星期三晚餐预定接龙（30元）
    1.椒盐排骨
    2.肉沫炒玉米胡萝卜
    3.肉沫焖豆腐
    4.炒青菜
例 桃子   1份午餐晚餐

1. 桃子   5份晚餐`,
    expected: [{ customerName: "桃子", quantity: 5, occasion: "dinner" }],
  },
  {
    id: "0611-thu-dinner",
    raw: `#接龙
6.11号星期四晚餐预定接龙（30元）
   1.小炒牛肉
  2.肉炒莴笋
  3.炒花菜
  4.炒青菜
例 桃子  1份午餐晚餐

1. 桃子   6份晚餐`,
    expected: [{ customerName: "桃子", quantity: 6, occasion: "dinner" }],
  },
  {
    id: "0613-fri-dinner-5",
    raw: `#接龙
6.13号星期五午餐预定接龙（30元）
   1.炖牛排骨
   2.炒生肠
   3.炒花菜
   4.炒青菜
 6.12号星期五晚餐预定接龙（30元）
   1.煎鸡中翅
   2.椒盐虾
   3.焖豆腐
   4.炒青菜
例 桃子   1份午餐晚餐

1. 桃子   5份晚餐`,
    expected: [{ customerName: "桃子", quantity: 5, occasion: "dinner" }],
  },
  {
    id: "0613-fri-multi",
    raw: `#接龙
6.13号星期五午餐预定接龙（30元）
   1.炖牛排骨
   2.炒生肠
   3.炒花菜
   4.炒青菜
 6.12号星期五晚餐预定接龙（30元）
   1.煎鸡中翅
   2.椒盐虾
   3.焖豆腐
   4.炒青菜
例 桃子   1份午餐晚餐

1. 桃子   6份晚餐
2. Catherine chen 晚餐1份
3. reni 午餐一份
4. 小柠檬 午餐一份
5. 王燕萍 午餐一份
6. lily  1份晚餐
7. 李湘 午餐一份
8. coco 午餐一份`,
    expected: [
      { customerName: "桃子", quantity: 6, occasion: "dinner" },
      { customerName: "Catherine chen", quantity: 1, occasion: "dinner" },
      { customerName: "reni", quantity: 1, occasion: "lunch" },
      { customerName: "小柠檬", quantity: 1, occasion: "lunch" },
      { customerName: "王燕萍", quantity: 1, occasion: "lunch" },
      { customerName: "lily", quantity: 1, occasion: "dinner" },
      { customerName: "李湘", quantity: 1, occasion: "lunch" },
      { customerName: "coco", quantity: 1, occasion: "lunch" },
    ],
  },
  {
    id: "0615-mon-lunch-dinner",
    raw: `#接龙
6.15号星期一午餐预定接龙（30元）
  1.小炒牛肉
  2.口菇肉片
  3.炒青瓜
  4.炒青菜
6.15号星期一晚餐预定接龙（30元）
  1.炒鸡肉丁
  2.咕噜肉
  3.炒小南瓜
  4.炒青菜
例 桃子  1份午餐晚餐

1. 桃子   5份晚餐`,
    expected: [{ customerName: "桃子", quantity: 5, occasion: "dinner" }],
  },
  {
    id: "0618-thu-lunch-dinner",
    raw: `#接龙
6.18号星期四午餐预定接龙（30元）
   1.红烧鲈鱼
   2.红烧肉
   3.炒茄子
   4.炒青菜
6.18号星期四晚餐预定接龙（30元）
   1.香煎鸡中翅
   2.农家一碗香
   3.炒洋葱
   4.炒青菜
例 桃子   1份午餐晚餐

1. 桃子    5份晚餐
2. 秀 午餐一份
3. 苏月兰 晚餐一份
4. 王燕萍 午餐一份
5. 大龙猫 午餐一份
6. Catherine chen 晚餐1份
7. Luye 晚餐一份`,
    expected: [
      { customerName: "桃子", quantity: 5, occasion: "dinner" },
      { customerName: "秀", quantity: 1, occasion: "lunch" },
      { customerName: "苏月兰", quantity: 1, occasion: "dinner" },
      { customerName: "王燕萍", quantity: 1, occasion: "lunch" },
      { customerName: "大龙猫", quantity: 1, occasion: "lunch" },
      { customerName: "Catherine chen", quantity: 1, occasion: "dinner" },
      { customerName: "Luye", quantity: 1, occasion: "dinner" },
    ],
  },
  {
    id: "0622-mon-dinner",
    raw: `#接龙
6.22号星期一晚餐预定接龙（30元）
  1.土豆烧排骨
  2.炒牛肉丸猪肉丸
  3.炒豆角
  4.炒青菜
  5.冬瓜汤
例 桃子   1份午餐晚餐

1. 桃子     7份晚餐
2. 苏月兰 晚餐一份`,
    expected: [
      { customerName: "桃子", quantity: 7, occasion: "dinner" },
      { customerName: "苏月兰", quantity: 1, occasion: "dinner" },
    ],
  },
  {
    id: "0623-tue-dinner",
    raw: `#接龙
6.23号星期二晚餐预定接龙（30元）
   1.炒鸡肉丁
   2.小炒肉
   3.炒小南瓜
   4.炒青菜
例 桃子   1份午餐晚餐

1. 桃子   5份晚餐`,
    expected: [{ customerName: "桃子", quantity: 5, occasion: "dinner" }],
  },
  {
    id: "0624-wed-lunch-dinner",
    raw: `#接龙
6.24号星期三午晚餐预定接龙（30元）
  1.小炒牛肉
  2.客家酿豆腐
  3.炒洋葱
  4.炒青菜
例 桃子  1份午餐晚餐

1. 桃子   8份晚餐
2. 苏月兰 晚餐一份`,
    expected: [
      { customerName: "桃子", quantity: 8, occasion: "dinner" },
      { customerName: "苏月兰", quantity: 1, occasion: "dinner" },
    ],
  },
  {
    id: "0626-fri-dinner-4",
    raw: `#接龙
6.26号星期五晚餐预定接龙（30元）
   1.红烧肉
   2.蒜蓉虾
   3.焖豆腐
   4.炒青菜
例 桃子   1份午餐晚餐

1. 桃子   4份晚餐`,
    expected: [{ customerName: "桃子", quantity: 4, occasion: "dinner" }],
  },
  {
    id: "0626-fri-dinner-luye",
    raw: `#接龙
6.26号星期五晚餐预定接龙（30元）
   1.红烧肉
   2.蒜蓉虾
   3.焖豆腐
   4.炒青菜
例 桃子   1份午餐晚餐

1. 桃子   4份晚餐
2. Luye 2份晚餐`,
    expected: [
      { customerName: "桃子", quantity: 4, occasion: "dinner" },
      { customerName: "Luye", quantity: 2, occasion: "dinner" },
    ],
  },
  {
    id: "0629-mon-dinner-5",
    raw: `#接龙
6.29号星期一晚餐预定接龙（30元）
  1.萝卜炖牛腩
  2.焖鸡蛋
  3.炒豆角
  4.炒青菜
  5.骨头海带汤
例 桃子   1份午餐晚餐

1. 桃子    5份晚餐`,
    expected: [{ customerName: "桃子", quantity: 5, occasion: "dinner" }],
  },
  {
    id: "0629-mon-dinner-sissi",
    raw: `#接龙
6.29号星期一晚餐预定接龙（30元）
  1.萝卜炖牛腩
  2.焖鸡蛋
  3.炒豆角
  4.炒青菜
  5.骨头海带汤
例 桃子   1份午餐晚餐

1. 桃子    5份晚餐
2. Sissi-CC 晚餐1份`,
    expected: [
      { customerName: "桃子", quantity: 5, occasion: "dinner" },
      { customerName: "Sissi-CC", quantity: 1, occasion: "dinner" },
    ],
  },
];
