/**
 * 旧版、尚未接入写链路的日期窗口裁剪 helper，仅保留给现有调用方/测试兼容，不代表当前
 * 产品契约。#160 将以稳定游标分页和按 seller/operator 的容量上限替换或删除它。
 * LLM 上下文裁剪见 run.ts:trimContext（≠ 展示历史）。
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
