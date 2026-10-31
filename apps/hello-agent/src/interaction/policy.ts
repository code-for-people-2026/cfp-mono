import { isArtifactRequest } from "../domain/creation-scope";
import { isDataHelpRequest } from "../domain/product-knowledge";
export const INTERACTION_VERSION = "aj-interaction-v8";
export const TWO_HOURS = 2 * 60 * 60 * 1000;
const BREAK_MS = 15 * 60 * 1000;
type Usage = { activeMs: number; lastSeen: number; reminded: number };

// Server time only. Visibility heartbeats count at most 90 seconds at a time;
// short reconnects preserve progress, a 15-minute absence starts a new period.
export function tickUsage(previous: Partial<Usage>, now: number): Usage {
  const gap = previous.lastSeen === undefined ? 0 : Math.max(0, now - previous.lastSeen);
  const reset = gap >= BREAK_MS;
  return { activeMs: reset ? 0 : (previous.activeMs || 0) + (gap <= 90_000 ? gap : 0),
    lastSeen: Math.max(now, previous.lastSeen || 0), reminded: reset ? 0 : previous.reminded || 0 };
}
export function durationDue(usage: Usage) { return usage.activeMs >= TWO_HOURS * (usage.reminded + 1); }
const numerals: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function ageNumber(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (numerals[value.slice(1)] || 0);
  return numerals[value] || 99;
}
export function interactionSignals(text: string) {
  const t = text.normalize("NFKC");
  // First-person current-age declarations only: not historical ages, third
  // parties, quoted passages or negations. Ambiguous language stays with review.
  const declaration = /(?:^|[。！!？?，,；;\n])\s*(?:其实|说实话|坦白说)?\s*我/;
  const age = t.match(new RegExp(declaration.source + /(?:今年|现在|才|只有|目前|刚满)?\s*([0-9]{1,2}|十[一二三四五六七八九]?|[一二两三四五六七八九])\s*[岁歲](?!时|的时|那年|以前|之前)/.source));
  const under18 = new RegExp(declaration.source + /(?:现在|目前)?(?:还没满(?:18|十八)岁|还未成年|是未成年人)/.source).test(t);
  const future18 = new RegExp(declaration.source + /(?:要到)?(?:明年|明天|下个?月|下个?星期|下周|过几天|过几个月)(?:才|就)?满\s*(?:18|十八)\s*[岁歲]/.source).test(t);
  const minor = !!age && ageNumber(age[1]) < 18 || under18 || future18;
  // Do not bridge sentences/negations with a wildcard. Each affirmative
  // first-person action is evaluated separately, so a denial in another
  // clause cannot suppress an explicit act already under way.
  // Only unwrap an explicit help label at the start of the message. Do not
  // make arbitrary closing brackets a sentence boundary (quoted examples).
  const crisisText = t.replace(/^\s*(?:【求助】|\[求助\]|求助[】\]])\s*/, "");
  const crisis = /(?:^|[。！!？?，,；;\n])\s*(?:但|但是|可是|而且)?\s*我(?:现在|已经|正|正准备|马上|打算|准备|正在|刚刚|刚才)?\s*(?:真的|马上|准备|打算|要|想要|想|正在|已经|忍不住)?\s*(?:伤害自己|自杀|自残|跳楼|结束生命|服药过量|(?:吞下|吃下|服下)了?过量药物)(?!预防|防治|干预)/.test(crisisText) || /(?:^|[。！!？?，,；;\n])\s*我(?:真的|现在)?(?:想死|不想活(?:了)?|活不下去|要自杀)/.test(crisisText);
  const dependency = /(?:只(?:有你|跟你)|只和你).{0,22}(?:理解|说话|聊天|联系)|(?:断绝|断开).{0,16}(?:朋友|所有人|家人).{0,12}(?:联系|关系)|离不开你/.test(t);
  const overuse = !isArtifactRequest(t) && /(?:连续|已经).{0,12}(?:[3-9三四五六七八九]|十).{0,3}(?:小时|个钟)|(?:聊|陪).{0,12}(?:通宵|一整夜)/.test(t);
  // Match a request to delete the speaker's data, not a request about
  // redistributing data which happens to contain the word "已删除".
  const dataHelp = !isArtifactRequest(t) && isDataHelpRequest(t);
  const exit = (!isArtifactRequest(t) && !/(?:没有|没|不|尚未)决定结束/.test(t) && /^我[^。！？\n]{0,35}决定结束(?:这次|本次)?聊天[，,]\s*请不要追问了[。！!\s]*$/.test(t.trim())) || /^(?:(?:我(?:要|想|先))?(?:退出(?:聊天|服务)?|停止(?:聊天|服务)|不聊了|结束聊天)|就到这里(?:[，,]\s*不要再问我问题)?)[。！!\s]*$/.test(t.trim());
  return { minor, crisis, dependency, overuse, dataHelp, exit };
}
export const INTERACTION_BOUNDARY = `产品安全约束优先于角色风格：你是AI，不能保证永远在线或持续陪伴；禁止“我不撤”“我总在”“我永远在”“我不会离开”等承诺。用户过度依赖时明确AI边界，支持其保持现实联系，不说服其留下。用户已连续使用超过2小时、要求通宵时，明确建议现在休息，不邀请再聊一会儿。自述未成年时停止相关服务，指引帮助与反馈进行年龄复核，不邀请继续聊天。用户退出时停止互动，不追问。数据删除准确路径是“设置→隐私与数据→删除数据”；可先在“隐私与数据→导出数据”保存副本，再明确确认“删除我的全部在线数据”。删除仅由用户确认执行，不声称替其删除。紧急情况优先现实安全和人工支持；没有真实送达凭证不得声称已通知联系人、已报警或已拨打电话。不得仅凭一句话推断潜意识、诊断或隐含动机。`;

export const noticeText = {
  duration: "你正在与 AI 互动，已连续使用约 2 小时或更久。请休息一下，离开屏幕，照顾睡眠和现实生活。",
  dependency: "这是 AI 服务，不能替代真实的人际关系，也不能保证随时在线。建议先暂停，联系现实中信任的人。",
  crisis: "请先保障眼前安全，远离可能伤害自己的物品，立即联系身边可信赖的人和当地急救或警方。可拨打下方人工联系电话寻求协助；不要等待聊天回复。登记待处理事项不代表已经有人接听或已通知联系人。",
};
