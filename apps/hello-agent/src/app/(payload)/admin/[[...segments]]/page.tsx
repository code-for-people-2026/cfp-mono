import config from "@payload-config";
import Link from "next/link";
import { RootPage } from "@payloadcms/next/views";
import { importMap } from "../importMap";
import { cms } from "../../../../cms/client";

export const metadata = { title: "管理后台 · 好人阿 J" };

export default async function Page(props: {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
}) {
  const payload = await cms();
  const count = await payload.count({
    collection: "admins",
    overrideAccess: true,
  });
  if (count.totalDocs === 0 && process.env.HELLO_ADMIN_BOOTSTRAP !== "true") {
    return (
      <section
        style={{
          maxWidth: 620,
          margin: "80px auto",
          padding: 24,
          lineHeight: 1.9,
        }}
      >
        <h1>先为你的 CMS 建立管理员</h1>
        <p>后台已就绪，但不会开放注册或预置默认密码。</p>
        <p>
          在本地终端设置 <code>HELLO_ADMIN_EMAIL</code> 和至少 12 位的{" "}
          <code>HELLO_ADMIN_PASSWORD</code>，然后运行：
        </p>
        <pre style={{ whiteSpace: "pre-wrap" }}>
          pnpm --filter @cfp/hello-agent cms:admin
        </pre>
        <p>
          初始化后刷新此页即可登录。密钥与数据库配置须与当前应用相同；完整说明见项目
          README。不要把真实密码粘贴到聊天或提交进仓库。
        </p>
        <Link href="/">返回好人阿 J</Link>
      </section>
    );
  }
  return RootPage({ ...props, config, importMap });
}
