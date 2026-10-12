import "./load-local-env";
import { cms } from "../src/cms/client";
import { seedAgents } from "../src/cms/seed";

const payload = await cms();
try {
  const result = await seedAgents(payload);
  console.log(
    `Agent seed 完成：新增 ${result.created}，保留 ${result.preserved}。未创建管理员或 ima 凭证。`,
  );
} finally {
  await payload.destroy();
}
