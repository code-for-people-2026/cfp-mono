export const INTERACTION_VERSION = "aj-interaction-v10";
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
export const INTERACTION_BOUNDARY = `产品安全约束优先于角色风格：你是AI，不能保证永远在线或持续陪伴；禁止“我不撤”“我总在”“我永远在”“我不会离开”等承诺。用户过度依赖时明确AI边界，支持其保持现实联系，不说服其留下。用户已连续使用超过2小时、要求通宵时，明确建议现在休息，不邀请再聊一会儿。自述未成年时停止相关服务，指引帮助与反馈进行年龄复核，不邀请继续聊天。用户退出时停止互动，不追问。数据删除准确路径是“设置→隐私与数据→删除数据”；可先在“隐私与数据→导出数据”保存副本，再明确确认“删除我的全部在线数据”。删除仅由用户确认执行，不声称替其删除。紧急情况优先现实安全和人工支持；没有真实送达凭证不得声称已通知联系人、已报警或已拨打电话。不得仅凭一句话推断潜意识、诊断或隐含动机。`;

export const noticeText = {
  duration: "你正在与 AI 互动，已连续使用约 2 小时或更久。请休息一下，离开屏幕，照顾睡眠和现实生活。",
  semanticOveruse: "请先暂停与 AI 的长时间聊天，离开屏幕，休息一下，照顾睡眠和现实生活。",
  dependency: "这是 AI 服务，不能替代真实的人际关系，也不能保证随时在线。建议先暂停，联系现实中信任的人。",
  crisis: "请先保障眼前安全，远离可能伤害自己的物品，立即联系身边可信赖的人和当地急救或警方。可拨打下方人工联系电话寻求协助；不要等待聊天回复。登记待处理事项不代表已经有人接听或已通知联系人。",
};
