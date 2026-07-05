/**
 * 地址前缀匹配（feature 004 抽到 shared，FE preview + be `fulfillmentsMatchingAddress` 共用）。
 * 桃子的地址是速记（`3a27b` = 栋3 A座 层27 b户），她输 `3a` 表达楼栋3A。
 *
 * **前缀，不是 substring**：`3a` 不该命中 `2d03a`（substring 会匹配 `03a` 里的 `3a`）。
 * **纯数字按楼栋边界**：`2` 只命中楼栋2（开头数字段 = "2"），不命中 `26B-301`（开头 = "26"）。
 * 带字母（`3a`/`26B`）继续 startsWith（字母已消歧）。
 */
export function addressMatches(address: string, fragment: string): boolean {
  const a = fragment.trim();
  if (!a) return false;
  if (/^\d+$/.test(a)) {
    return (address.match(/^\d+/)?.[0] ?? "") === a;
  }
  return address.startsWith(a);
}
