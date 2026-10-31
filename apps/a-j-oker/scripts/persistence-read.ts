import assert from "node:assert/strict";
import { cms } from "../src/cms/client";
import { Repository } from "../src/cms/repository";
import { PayloadSessionService } from "../src/agent/payload-session-service";

// 只由集成测试启动；同一临时数据库，新的进程与新的 Payload / ADK 实例。
const [ownerId, sessionId, turnId, mediaId] = process.argv.slice(2);
assert.ok(
  ownerId && sessionId && turnId && mediaId && process.env.HELLO_DATABASE_URI,
);
const payload = await cms();
try {
  const repo = new Repository(payload, { id: ownerId, auth: "cookie" });
  assert.equal(
    (await repo.get("sessions", Number(sessionId))).title,
    "集成测试",
  );
  const greeting = await repo.get("greetings", Number(turnId));
  assert.equal(greeting.status, "completed");
  assert.ok(
    typeof greeting.greeting === "string" && greeting.greeting.length > 0,
  );
  assert.equal(
    (await repo.get("media", Number(mediaId))).mimeType,
    "image/jpeg",
  );
  const session = await new PayloadSessionService(repo).getSession({
    appName: "hello_agent",
    userId: ownerId,
    sessionId: turnId,
  });
  assert.ok(session && session.events.length >= 3);
} finally {
  await payload.destroy();
}
