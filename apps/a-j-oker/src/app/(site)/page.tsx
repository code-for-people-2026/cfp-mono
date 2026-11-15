import { redirect } from "next/navigation";

// 用户界面由独立 Taro 工程编译；Next 只承载 API、CMS 和同源 H5 预览。
export default function Page() {
  redirect("/chat/index.html");
}
