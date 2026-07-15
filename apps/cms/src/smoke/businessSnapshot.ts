export const KITH_INN_BUSINESS_TABLES = [
  "sellers_enabled_modules", "sellers", "operators_sessions", "operators", "customers",
  "offerings", "offerings_rels", "menu_plans", "menu_plans_rels", "service_slots",
  "orders", "order_items", "fulfillments", "chat_messages", "subscriptions",
] as const;

type BusinessSnapshot = Record<
  (typeof KITH_INN_BUSINESS_TABLES)[number],
  { count: number; digest: string }
>;
type CountQuery = (statement: string) => Promise<{
  rows: Array<{ table?: unknown; count?: unknown; digest?: unknown }>;
}>;

/** Count every old kith-inn business table; v1 and Payload metadata are intentionally out of scope. */
export async function readKithInnBusinessSnapshot(query: CountQuery): Promise<BusinessSnapshot> {
  const statement = KITH_INN_BUSINESS_TABLES.map((table) => `SELECT '${table}' AS table,
      count(*)::int AS count,
      md5(COALESCE(string_agg(md5(row_to_json(snapshot_row)::text), ''
        ORDER BY md5(row_to_json(snapshot_row)::text)), '')) AS digest
      FROM cms.${table} AS snapshot_row`).join("\nUNION ALL\n");
  const rows = (await query(statement)).rows;
  const allowed = new Set<string>(KITH_INN_BUSINESS_TABLES);
  const captured = new Map<string, { count: number; digest: string }>();
  for (const row of rows) {
    const count = Number(row.count);
    if (typeof row.table !== "string" || !allowed.has(row.table) || captured.has(row.table) ||
      !Number.isSafeInteger(count) || count < 0 || typeof row.digest !== "string" || !/^[0-9a-f]{32}$/.test(row.digest)) {
      throw new Error("business snapshot unavailable");
    }
    captured.set(row.table, { count, digest: row.digest });
  }
  if (captured.size !== KITH_INN_BUSINESS_TABLES.length) throw new Error("business snapshot unavailable");
  const entries = KITH_INN_BUSINESS_TABLES.map((table) => [table, captured.get(table)!] as const);
  return Object.fromEntries(entries) as BusinessSnapshot;
}
