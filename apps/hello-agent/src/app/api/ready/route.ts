import { cms } from "../../../cms/client";
import { checkPlatformQuota } from "../../../cms/platform-quota";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await cms();
    // 只确认业务表可读，不向健康检查返回访客、内容或管理员信息。
    await payload.count({ collection: "sessions", overrideAccess: true });
    const configured = await payload.count({ collection: "agent-configs", overrideAccess: true, where: { and: [{ key: { equals: "coordinator" } }, { enabled: { equals: true } }] } });
    if (configured.totalDocs !== 1) throw new Error("Agent seed missing");
    await checkPlatformQuota(payload);
    return Response.json(
      { ok: true, service: "hello-agent", release: process.env.HELLO_RELEASE || "local" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false, service: "hello-agent" }, { status: 503 });
  }
}
