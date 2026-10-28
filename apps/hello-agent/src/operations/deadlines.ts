// Conservative internal deadlines: weekdays 09:00–17:00 China Standard Time.
// Public holidays do not extend these targets; this can only make them earlier
// than the published 1/7-working-day promise, not justify a later response.
export function workingDeadline(start: number, days: number): string {
  const offset = 8 * 3600_000;
  let local = new Date(start + offset), remaining = days * 8 * 3600_000;
  while (remaining > 0) {
    const day = local.getUTCDay(), hour = local.getUTCHours();
    if (day === 0 || day === 6 || hour >= 17) { local.setUTCDate(local.getUTCDate() + 1); local.setUTCHours(9, 0, 0, 0); continue; }
    if (hour < 9) local.setUTCHours(9, 0, 0, 0);
    const end = new Date(local); end.setUTCHours(17, 0, 0, 0);
    const consumed = Math.min(remaining, end.getTime() - local.getTime());
    local = new Date(local.getTime() + consumed); remaining -= consumed;
  }
  return new Date(local.getTime() - offset).toISOString();
}
export const COMPLAINT_SLA = "孙逢处理；工作日 9:00—17:00，1 个工作日内受理、7 个工作日内处理并反馈，延期提前说明。紧急情况请使用全天人工联系电话，不按普通投诉排期。";
