/**
 * Normalize a 接龙 customer name for matching (PRD §6.4). MVP heuristic:
 * trim → collapse spaces → lowercase (Latin; no-op for CJK) → strip a conservative
 * set of Chinese honorific suffixes. Handles the variants in 桃子's 接龙
 * (`lily`/`Lily`, `Catherine chen`/casing, `王燕萍`/`王阿姨`).
 *
 * `// ponytail:` bare `姐`/`哥` are NOT stripped (too aggressive — would eat real
 * names). Upgrade to a learned alias table (manual merge, PRD §6.4) when variants
 * denser than this heuristic can handle.
 */
const HONORIFIC_SUFFIXES = ["阿姨", "阿叔", "叔叔", "师傅", "大姐", "小哥", "阿姐"];

export function normalizeCustomerName(raw: string): string {
  let s = raw.trim();
  for (const suf of HONORIFIC_SUFFIXES) {
    if (s.length > suf.length && s.endsWith(suf)) {
      s = s.slice(0, -suf.length).trim();
      break;
    }
  }
  return s.replace(/\s+/g, " ").toLowerCase();
}
