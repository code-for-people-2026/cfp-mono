/**
 * 展示对话留存策略（PRD §5.5 / Tech Spec §4.1 三层记忆·展示层）。滚动 2 天窗口（今天+
 * 昨天，每天 0 点清前天）+ 1000 条硬上限（超出删最旧 200）。纯函数——cms 写 chat_messages
 * 时由 be 调用它裁剪（§3.3④）。LLM 上下文裁剪见 run.ts:trimContext（≠ 展示历史）。
 *
 * `// ponytail:` 0 点边界按 `now` 的本地时区算（生产服务器配 Asia/Shanghai，或调用方传
 * Asia/Shanghai 本地化的 now）；要硬保证跨时区时再上 TZ 库。
 */
export type TimedMessage = { createdAt: string };

export function retainMessages<T extends TimedMessage>(
  messages: T[],
  now: Date,
  opts: { windowDays?: number; cap?: number; overCapDrop?: number } = {},
): { keep: T[]; dropped: number } {
  const windowDays = opts.windowDays ?? 2;
  const cap = opts.cap ?? 1000;
  const overCapDrop = opts.overCapDrop ?? 200;

  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0); // 今天 0 点
  cutoff.setDate(cutoff.getDate() - (windowDays - 1)); // windowDays 天的起点（2 天→昨天 0 点）

  const inWindow = messages.filter((m) => new Date(m.createdAt) >= cutoff);
  const keep = inWindow.length > cap ? inWindow.slice(overCapDrop) : inWindow;
  return { keep, dropped: messages.length - keep.length };
}
