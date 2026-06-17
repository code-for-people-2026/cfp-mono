import { DocumentPage } from "../../shared/document-page";
import { map } from "@/content/site";

// 纯文本版牛马能力剥夺矩阵。当前站内没有任何入口指向它：导航、页脚和「继续阅读」里
// 与矩阵有关的链接都已指向独立部署的 wam 应用（见 content/site.ts 的 directionMapHref）。
// 这里先保留页面与 /map 路由，等以后这张矩阵迁回官网项目时，再把那些入口指回 /map。
export default function MapPage() {
  return <DocumentPage document={map} />;
}

