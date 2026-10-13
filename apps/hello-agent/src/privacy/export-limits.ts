import { AppError } from "../domain/contracts";
import { rateLimitGroup } from "../server/http";

const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT_RECORDS = 1000;
const tooLarge = () => new AppError(413, "数据超过自助导出上限（8 MB 或 1000 条），未生成文件；请通过隐私政策中的联系渠道申请完整副本");
export class ExportBudget {
  private bytes = 1024; // JSON field names, delimiters, and envelope overhead.
  private records = 0;
  requireRoom(bytes: number) {
    if (bytes + this.bytes > MAX_EXPORT_BYTES) throw tooLarge();
  }
  add<T>(value: T, record = true): T {
    if (record && ++this.records > MAX_EXPORT_RECORDS) throw tooLarge();
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8") + 1;
    this.requireRoom(bytes);
    this.bytes += bytes;
    return value;
  }
  verify(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_EXPORT_BYTES) throw tooLarge();
  }
}
let activeExports = 0;
export function beginPrivacyExport(owner: string) {
  // Single-process limits also cover fresh identities. A multi-instance rollout
  // must move this gate to the shared limiter before increasing replica count.
  if (activeExports >= 2) throw new AppError(429, "导出正在排队，请稍后重试");
  rateLimitGroup([
    { key: `privacy-export:owner:${owner}`, maximum: 2 },
    { key: "privacy-export:global", maximum: 20 },
  ]);
  activeExports++;
  let released = false;
  return () => { if (!released) { activeExports--; released = true; } };
}
