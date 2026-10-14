import { AgeService } from "../../../age/service";
import { privacyService } from "../../../privacy/service";
import { cms } from "../../../cms/client";
import { Repository } from "../../../cms/repository";
import { GreetingService } from "../../../domain/greetings";
import { authenticate, withAuthenticatedExecution } from "../../../server/auth";
import { failure, rateLimit, readJson } from "../../../server/http";
import { handleMcp } from "../../../server/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const payload = await cms();
    const owner = await authenticate(payload, request, true);
    rateLimit(owner.id);
    const body = await readJson(request);
    return await withAuthenticatedExecution(payload, request, owner, async (current) => {
      await new AgeService(payload, current).requireCapability();
      await privacyService(payload, current).requireExternalAccess();
      // JSON transport resolves after the tool response, keeping the execution
      // lease through history/image reads and writes, not just dispatch.
      return await handleMcp(request, body, new GreetingService(new Repository(payload, current)));
    }, true);
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
