import { uniqueNamesGenerator } from "unique-names-generator";

const qualities = ["会留白的", "练习正念的", "懂得接纳的", "慢慢觉察的", "拥抱情绪的", "寻找心流的", "松弛一点的", "善待自己的", "认真倾听的", "保持好奇的", "收集小确幸的", "守护边界的"];
const animals = ["小水豚", "水獭", "考拉", "小熊猫", "小狐狸", "橘猫", "企鹅", "小海獭", "小海龟", "鲸鱼", "小鹿", "刺猬"];

export function randomNickname(previous = "") {
  // Exclude the current animal so every tap visibly changes the suggestion.
  return uniqueNamesGenerator({ dictionaries: [qualities, animals.filter((animal) => !previous.endsWith(animal))], separator: "", length: 2 });
}
