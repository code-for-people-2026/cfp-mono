import { generateTypes } from "payload/node";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 只加载配置并生成类型，不初始化 Payload、不连接数据库，也不读取部署凭证。
process.env.PAYLOAD_SECRET = "type-generation-only-not-a-runtime-secret";
process.env.HELLO_DEPLOYED = "false";
const config = await (await import("../payload.config")).default;
if (process.argv.includes("--check")) {
  const directory = await mkdtemp(path.join(tmpdir(), "hello-payload-types-"));
  const expected = config.typescript.outputFile;
  const output = path.join(directory, "payload-types.ts");
  try {
    process.env.PAYLOAD_TS_OUTPUT_PATH = output;
    await generateTypes(config, { log: false });
    if (
      (await readFile(expected, "utf8")) !== (await readFile(output, "utf8"))
    ) {
      throw new Error(
        "Payload 生成类型已过期，请运行 pnpm generate:types 并一并提交生成文件",
      );
    }
    console.log("Payload 生成类型与当前集合配置一致。");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  await generateTypes(config);
}
