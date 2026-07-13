/** Keep Payload date comparisons identical across Postgres and SQLite text storage. */
export function normalizeServiceSlotDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("invalid service slot date");
  return date.toISOString();
}
