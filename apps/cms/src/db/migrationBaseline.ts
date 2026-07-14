export const CMS_BASELINE_TABLES = [
  "sellers_enabled_modules",
  "sellers",
  "operators_sessions",
  "operators",
  "customers",
  "offerings",
  "offerings_rels",
  "menu_plans",
  "menu_plans_rels",
  "service_slots",
  "orders",
  "order_items",
  "fulfillments",
  "chat_messages",
  "subscriptions",
  "kiv1_sellers",
  "kiv1_operators",
  "kiv1_customer_profiles",
  "kiv1_offerings",
  "kiv1_meal_slots_menu_items",
  "kiv1_meal_slots",
  "kiv1_booking_batches",
  "kiv1_booking_batches_rels",
  "kiv1_orders",
  "payload_kv",
  "payload_locked_documents",
  "payload_locked_documents_rels",
  "payload_preferences",
  "payload_preferences_rels",
  "payload_migrations",
] as const;

/** Accept an empty database or a complete push-era schema, never a partial one. */
export function shouldAdoptCmsBaseline(tableNames: Iterable<string>): boolean {
  const existing = new Set(tableNames);
  if (existing.size === 0) return false;
  const missing = CMS_BASELINE_TABLES.filter((tableName) => !existing.has(tableName));
  if (missing.length > 0) {
    throw new Error(`Cannot adopt incomplete CMS schema; missing tables: ${missing.join(", ")}`);
  }
  return true;
}
