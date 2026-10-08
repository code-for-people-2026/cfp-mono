import type { Payload } from "payload";
import type { Inspiration, Turn } from "@cfp/hello-agent-contracts";
import type { Session as AdkSession } from "@google/adk";
import type { Repository } from "./repository";

// 只由 tsc 检查，绝不执行。若接口退化为 any/unknown，预期错误消失也会使检查失败。
async function checkTypes(repo: Repository, payload: Payload) {
  const row = await repo.get("greetings", 1);
  const input: Inspiration = row.input;
  const turn: Turn = row;
  const snapshot: AdkSession = (await repo.get("adk-sessions", 1)).snapshot;
  await repo.create("sessions", { title: "有效输入" });
  await repo.update("greetings", 1, { status: "completed" });
  // @ts-expect-error 集合名不能任意填写。
  await repo.list("greeting-typo");
  // @ts-expect-error 访客仓库不能碰认证集合。
  await repo.get("credentials", 1);
  // @ts-expect-error 必填字段不能丢失。
  await repo.create("sessions", {});
  // @ts-expect-error 数据必须匹配指定集合，不能推宽 C 绕过检查。
  await repo.create("sessions", { mimeType: "image/jpeg" });
  // @ts-expect-error owner 只由仓库注入。
  await repo.create("sessions", { title: "测试", owner: "someone-else" });
  // @ts-expect-error 状态不能随意拼写。
  await repo.update("greetings", 1, { status: "done" });
  await repo.update("greetings", 1, {
    // @ts-expect-error JSON 输入同样受类型约束。
    input: { text: "测试", mediaIds: ["1"] },
  });
  // @ts-expect-error 读取结果不再有任意字段索引。
  void row.inventedField;
  // @ts-expect-error Payload Local API 本身也必须启用 GeneratedTypes。
  await payload.create({ collection: "greetings", data: { status: "done" } });
  // @ts-expect-error ADK 快照不能靠不完整对象蒙混写入。
  await repo.create("adk-sessions", { key: "test", snapshot: {} });
  return { input, turn, snapshot };
}
void checkTypes;
