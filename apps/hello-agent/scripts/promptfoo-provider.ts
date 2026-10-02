import "./load-local-env";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 每个评测进程使用独立数据库，评测执行完整 ADK -> 工具 -> Payload 链路。
const directory = await mkdtemp(path.join(tmpdir(), "hello-promptfoo-"));
process.env.HELLO_DATABASE_URI = `file:${directory}/eval.db`;
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");

export default class HelloProvider {
  id() {
    return "hello-agent-full-pipeline";
  }
  async callApi(prompt: string) {
    try {
      const service = new GreetingService(
        new Repository(await cms(), { id: randomUUID(), auth: "cookie" }),
      );
      const session = await service.createSession("Promptfoo 评测");
      const result = await service.generateGreeting({
        sessionId: session.id,
        requestId: randomUUID(),
        mode: "platform",
        input: { text: prompt },
      });
      return {
        output: JSON.stringify({
          greeting: result.greeting,
          association: result.association,
          status: result.status,
          promptVersion: result.promptVersion,
        }),
      };
    } catch {
      return {
        error: "完整生成链路失败（请检查真实模型凭证、网络及保存结果）",
      };
    }
  }
}
