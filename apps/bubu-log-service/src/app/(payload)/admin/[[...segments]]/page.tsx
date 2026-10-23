import config from "@payload-config";
import { assertRuntimeAvailable, runtimeState } from "../../../../runtime-state";
import { RootPage } from "@payloadcms/next/views";
import { importMap } from "../importMap";
export const metadata = { title: "运营后台 · 哺哺日记" };
export const dynamic = "force-dynamic";
export default async function Page(props: {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
}) {
  assertRuntimeAvailable();
  const count = await runtimeState()!.runtime!.store.payload.count({ collection: "ops-users", overrideAccess: true });
  if (!count.totalDocs) return (
    <section style={{ maxWidth: 680, margin: "64px auto", padding: 24, lineHeight: 1.8 }}>
      <h1>初始化哺哺日记运营后台</h1>
      <p>请先停止服务，在本机配置初始管理员邮箱、至少 14 位密码与明确的宝宝范围，再运行：</p>
      <pre>pnpm --filter @cfp/bubu-log-service cms:admin</pre>
      <p>使用与服务相同的身份目录和 Payload 密钥。完成后重启服务，刷新此页面登录。</p>
    </section>
  );
  return RootPage({ ...props, config, importMap });
}
