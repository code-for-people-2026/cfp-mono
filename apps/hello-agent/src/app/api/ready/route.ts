import { cms } from "../../../cms/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await cms();
    // 只确认业务表可读，不向健康检查返回访客、内容或管理员信息。
    await payload.count({ collection: "sessions", overrideAccess: true });
    return Response.json(
      { ok: true, service: "hello-agent", release: process.env.HELLO_RELEASE || "local" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false, service: "hello-agent" }, { status: 503 });
  }
}
