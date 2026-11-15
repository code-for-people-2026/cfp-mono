import { cms } from "../src/cms/client";
import { Repository } from "../src/cms/repository";
import { MediaService } from "../src/domain/media";

if (process.env.HELLO_MEDIA_STORAGE !== "oss" || process.env.HELLO_IMAGE_MIGRATION_BACKUP_CONFIRMED !== "true")
  throw new Error("请先备份数据库，并显式确认备份及 OSS 配置");
const payload = await cms();
let cursor = 0, migrated = 0, verified = 0;
try {
  while (true) {
    const { docs } = await payload.find({ collection: "media", overrideAccess: true,
      where: { id: { greater_than: cursor } }, sort: "id", limit: 50, depth: 0 });
    if (!docs.length) break;
    for (const row of docs) {
      if (typeof row.owner !== "string") throw new Error("图片缺少归属，停止迁移");
      const service = new MediaService(new Repository(payload, { id: row.owner, auth: "cookie" }));
      if (await service.migrate(Number(row.id))) migrated++;
      verified++;
      cursor = Number(row.id);
    }
  }
  console.log(JSON.stringify({ migrated, verified, storage: "oss" }));
} catch {
  console.error("图片迁移未完成：已成功的记录可继续使用，未成功的记录仍保留原内容；请排查配置后重试。");
  process.exitCode = 1;
} finally { await payload.destroy(); }
