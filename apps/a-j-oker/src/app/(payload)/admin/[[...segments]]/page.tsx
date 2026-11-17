import config from "@payload-config";
import { RootPage } from "@payloadcms/next/views";
import { importMap } from "../importMap";
import { cms } from "../../../../cms/client";
import { isFirstAdminRegistrationOpen } from "../../../../cms/first-admin";
import { FirstAdminForm } from "../first-admin-form";

export const metadata = { title: "管理后台 · 阿 J 先生" };

export default async function Page(props: {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
}) {
  const payload = await cms();
  if (await isFirstAdminRegistrationOpen(payload)) {
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
        <p>创建成功后会直接登录。此入口只在系统从未初始化时开放。</p>
        <FirstAdminForm />
      </section>
    );
  }
  return RootPage({ ...props, config, importMap });
}
