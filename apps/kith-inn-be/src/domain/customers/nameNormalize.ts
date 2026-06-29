/**
 * Normalize a 接龙 customer name for matching (PRD §6.4). MVP = trim → collapse
 * spaces → lowercase (Latin; no-op for CJK). Handles casing/spacing variants
 * (`lily`/`Lily`, `Catherine chen`/casing).
 *
 * Variant matching (`王燕萍` / `王阿姨` / `小王` = same person) is **manual merge**,
 * NOT automatic (PRD §6.4) — so we do NOT strip honorifics: `王阿姨`→`王` would
 * neither match the stored full name `王燕萍` nor stay unique across 王-surnamed
 * customers (Codex). A learned alias table is the V1 upgrade path when needed.
 */
export function normalizeCustomerName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}
