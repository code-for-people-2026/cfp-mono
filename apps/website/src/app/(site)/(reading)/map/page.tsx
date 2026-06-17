import { DocumentPage } from "../../shared/document-page";
import { getDocument, getUiStrings } from "@/lib/content";

// 纯文本版牛马能力剥夺矩阵。当前站内没有任何入口指向它：导航、页脚和「继续阅读」里
// 与矩阵有关的链接都已指向独立部署的 wam 应用（site-settings.directionMapUrl）。
// 这里先保留页面与 /map 路由，等以后这张矩阵迁回官网项目时，再把那些入口指回 /map。
export const dynamic = "force-dynamic";

export default async function MapPage() {
  const [document, ui] = await Promise.all([getDocument("map"), getUiStrings()]);
  return <DocumentPage document={document} backToHome={ui.backToHome} />;
}
