import { cms } from "../../../cms/client";
import { Repository } from "../../../cms/repository";
import { GreetingService } from "../../../domain/greetings";
import { authenticate } from "../../../server/auth";
import { failure, rateLimit, readJson } from "../../../server/http";
import { handleMcp } from "../../../server/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const payload = await cms();
    const owner = await authenticate(payload, request, true);
    rateLimit(owner.id);
    return await handleMcp(
      request,
      await readJson(request),
      new GreetingService(new Repository(payload, owner)),
    );
  } catch (error) {
    return failure(error);
  }
}
export function GET() {
  return new Response("本接口使用无状态 Streamable HTTP，请发送 POST。", {
    status: 405,
  });
}
export function DELETE() {
  return new Response(null, { status: 405 });
}
