import { setTimeout as sleep } from "node:timers/promises";
import { feishuConfig } from "../src/operations/feishu";
import { FeishuAlerts } from "../src/operations/alerts";
import { errorCategory } from "../src/server/error-category";
const args = process.argv.slice(2);
if (!["--worker", "--once", "--send-test", "--confirm-test"].includes(args[0]) || (args.length !== (args[0] === "--confirm-test" ? 2 : 1)))
  throw new Error("请选择 --worker、--once、--send-test 或 --confirm-test <手机收到的测试编号>");
const config = feishuConfig();
if (!config) throw new Error("请在服务端配置有效的飞书 Webhook、签名密钥和 HTTPS 应用地址；不要将密钥写入日志");
if (["--worker", "--once"].includes(args[0]) && !config.enabled) throw new Error("自动提醒尚未启用，请先完成真实收件确认");
const { cms } = await import("../src/cms/client");
const payload = await cms();
const alerts = new FeishuAlerts(payload, config);
const stop = new AbortController();
process.once("SIGTERM", () => stop.abort()); process.once("SIGINT", () => stop.abort());
try {
  if (args[0] === "--send-test") {
    const result = await alerts.test();
    console.log(JSON.stringify({ ...result, notice: "仅平台接收结果。需本人在手机确认后，用 --confirm-test 登记；不代表危机处置完成。" }));
    if (!result.ok) process.exitCode = 1;
  } else if (args[0] === "--confirm-test") { await alerts.confirmTest(args[1]); console.log("已记录本人收件确认；保持任务持续运行后才显示通知可用。"); }
  else do {
    try { const result = await alerts.tick(); if (result !== "idle") console.log(JSON.stringify({ at: new Date().toISOString(), result })); }
    catch (error) { console.error(JSON.stringify({ at: new Date().toISOString(), event: "feishu.worker_failure", category: errorCategory(error), notice: "本轮失败，待处理记录已保留" })); if (args[0] === "--once") process.exitCode = 1; }
    if (args[0] === "--once") break;
    await sleep(2000, undefined, { signal: stop.signal }).catch(() => {});
  } while (!stop.signal.aborted);
} finally { await payload.destroy(); }
