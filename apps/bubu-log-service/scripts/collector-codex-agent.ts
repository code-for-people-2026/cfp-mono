import { CodexAgentExecutor } from "../src/collector/codex";
import type { AgentTask } from "../src/collector/runner";

async function main() {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error("COLLECTOR_TASK_TOO_LARGE"); chunks.push(chunk); }
  const task = JSON.parse(Buffer.concat(chunks).toString("utf8")) as AgentTask;
  if (task.protocol !== "bubu-collector-agent/v1" || !Array.isArray(task.messages) || !Array.isArray(task.tools) || !task.resultSchema) throw new Error("COLLECTOR_TASK_INVALID");
  const flag = process.argv.indexOf("--codex");
  const executable = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (flag >= 0 && !executable) throw new Error("COLLECTOR_CODEX_PATH_REQUIRED");
  process.stdout.write(JSON.stringify(await new CodexAgentExecutor({ executable }).execute(task)));
}
main().catch(error => {
  const code = error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : "COLLECTOR_CODEX_FAILED";
  console.error(JSON.stringify({ error: code })); process.exitCode = 1;
});
