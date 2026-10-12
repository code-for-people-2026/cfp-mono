import "./load-local-env";
import { cms } from "../src/cms/client";
import { renameAgentBrand } from "../src/cms/rename-brand";

const payload = await cms();
try {
  const result = await renameAgentBrand(payload);
  console.log(
    `阿 Q + 改名完成：更新 ${result.updated}，无需改动 ${result.preserved}。`,
  );
} finally {
  await payload.destroy();
}
