import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CollectorMcpClient, CollectorRunner, CommandAgentExecutor, scheduleCollector, WechatSourceReader } from "../src/collector/runner";
import { CodexAgentExecutor, codexAgentOptionsSchema } from "../src/collector/codex";
import { ExactLocalMediaResolver, exactMediaConfigSchema } from "../src/collector/media";

const command = z.object({ executable: z.string().min(1), args: z.array(z.string()).optional(), cwd: z.string().optional(), timeoutMs: z.number().int().min(100).max(600_000).optional(), env: z.record(z.string(), z.string()).optional() }).strict();
const schema = z.object({
  mcpUrl: z.url(), tokenFile: z.string().min(1), babyId: z.string().min(1), jobId: z.string().optional(),
  pollMs: z.number().int().min(1000).max(60_000).default(10_000),
  agent: command.optional(),
  codex: codexAgentOptionsSchema.optional(),
  media: exactMediaConfigSchema.optional(),
  source: z.object({ python: z.string(), pythonEnv: z.record(z.string(), z.string()).optional(), fixtureManifest: z.string().optional(), configPath: z.string().optional(), allowLive: z.boolean().default(false) }).strict().optional(),
}).strict();

async function privateJson(file: string) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 65536 || (info.mode & 0o077) !== 0) throw new Error("COLLECTOR_CONFIG_MUST_BE_PRIVATE");
  return JSON.parse(await readFile(file, "utf8"));
}
async function run() {
  const argv = process.argv.slice(2);
  const configFlag = argv.indexOf("--config");
  if (configFlag < 0 || !argv[configFlag + 1]) throw new Error("Usage: collector --config <private-json> [--schedule | --control-json <private-json>]. Default: one controlled batch; no source discovery or real binding is enabled.");
  const config = schema.parse(await privateJson(resolve(argv[configFlag + 1]!)));
  const client = new CollectorMcpClient(new URL(config.mcpUrl), async () => {
    const info = await stat(config.tokenFile);
    if (!info.isFile() || info.size > 1024 || (info.mode & 0o077) !== 0) throw new Error("COLLECTOR_TOKEN_FILE_MUST_BE_PRIVATE");
    const token = (await readFile(config.tokenFile, "utf8")).trim();
    if (!/^[\w-]{43}$/.test(token)) throw new Error("COLLECTOR_TOKEN_INVALID");
    return token;
  });
  await client.connect();
  try {
    const controlFlag = argv.indexOf("--control-json");
    if (controlFlag >= 0) {
      if (!argv[controlFlag + 1]) throw new Error("COLLECTOR_CONTROL_FILE_REQUIRED");
      const control = await privateJson(resolve(argv[controlFlag + 1]!));
      if (!["configure", "status", "backfill", "retry"].includes(control.action)) throw new Error("COLLECTOR_CONTROL_INVALID");
      console.log(JSON.stringify(await client.call("bubu_collector", { ...control, babyId: config.babyId })));
      return;
    }
    if (!config.jobId || (!config.agent && !config.codex) || !config.source) throw new Error("COLLECTOR_RUN_CONFIGURATION_REQUIRED");
    if (config.agent && config.codex) throw new Error("COLLECTOR_AGENT_MODE_AMBIGUOUS");
    const source = config.source;
    if (!source.fixtureManifest && !(source.allowLive && source.configPath)) throw new Error("LIVE_SOURCE_DISABLED");
    if (source.fixtureManifest && (source.configPath || source.allowLive)) throw new Error("COLLECTOR_SOURCE_MODE_AMBIGUOUS");
    const reader = new WechatSourceReader({ executable: source.python, args: [resolve(dirname(fileURLToPath(import.meta.url)), "collector-wechat-source.py")], env: source.pythonEnv },
      source.fixtureManifest ? { fixtureManifest: source.fixtureManifest } : { configPath: source.configPath!, allowLive: true });
    const agent = config.codex ? new CodexAgentExecutor(config.codex) : new CommandAgentExecutor(config.agent!);
    const runner = new CollectorRunner(client, reader, agent, config.media ? { resolver: new ExactLocalMediaResolver(config.media), uploader: client } : undefined);
    if (argv.includes("--schedule")) {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGTERM", stop); process.once("SIGINT", stop);
      try { await scheduleCollector(runner, { babyId: config.babyId, jobId: config.jobId, pollMs: config.pollMs, signal: controller.signal, onResult: result => console.log(JSON.stringify(result)) }); }
      finally { process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
    } else console.log(JSON.stringify(await runner.once(config.babyId, config.jobId)));
  } finally { await client.close(); }
}
run().catch(error => {
  // Command errors never echo source messages, paths containing account names, or credentials.
  const code = error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : "COLLECTOR_CLI_FAILED";
  console.error(JSON.stringify({ error: code })); process.exitCode = 1;
});
