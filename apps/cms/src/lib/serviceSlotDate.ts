/** Keep Payload date comparisons identical across Postgres and SQLite text storage. */
export function normalizeServiceSlotDate(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("invalid service slot date");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("invalid service slot date");
  return date.toISOString();
}
