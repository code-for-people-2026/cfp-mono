import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// 只使用阿里云 CLI 和云助手，不依赖服务器 SSH 密码；目标从私密环境传入。
const instance = process.env.HELLO_ECS_INSTANCE;
const region = process.env.HELLO_ECS_REGION || "cn-shenzhen";
const profile = process.env.HELLO_ALIYUN_PROFILE || "cfp-deploy";
if (!instance || !/^i-[a-z0-9]+$/.test(instance)) {
  throw new Error("请设置本次部署目标 HELLO_ECS_INSTANCE");
}
function api(action, parameters) {
  const args = ["ecs", action, "--profile", profile, "--RegionId", region];
  for (const [key, value] of Object.entries(parameters)) {
    args.push(`--${key}`, String(value));
  }
  try {
    return JSON.parse(execFileSync("aliyun", args, { encoding: "utf8", maxBuffer: 2 ** 22 }));
  } catch {
    // 不输出参数或完整命令，避免文件内容出现在错误日志。
    throw new Error(`阿里云 ${action} 未成功，请核对权限和目标`);
  }
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 2500));
async function run(content, timeout = 1200) {
  const { InvokeId } = api("RunCommand", {
    "InstanceId.1": instance, Type: "RunShellScript", ContentEncoding: "PlainText",
    CommandContent: content, KeepCommand: false, Name: "aj-preview", Timeout: timeout,
  });
  console.log(`云助手任务：${InvokeId}`);
  for (let elapsed = 0; elapsed < timeout + 60; elapsed += 2.5) {
    await pause();
    const result = api("DescribeInvocationResults", { InvokeId, ContentEncoding: "PlainText" })
      .Invocation?.InvocationResults?.InvocationResult?.[0];
    if (!result || ["Pending", "Running", "Scheduled"].includes(result.InvocationStatus)) continue;
    if (result.Output) console.log(result.Output);
    if (result.InvocationStatus !== "Success" || result.ExitCode !== 0) {
      throw new Error(`远端任务失败：${result.InvocationStatus} / ${result.ExitCode}`);
    }
    return;
  }
  throw new Error(`等待超时，请查询任务 ${InvokeId}，不要重复启动部署`);
}
async function send(content, target) {
  if (!/^\/opt\/cfp-hello-agent\/[a-zA-Z0-9/_.-]+$/.test(target) || path.posix.normalize(target) !== target) {
    throw new Error("发送目标必须在独立的 /opt/cfp-hello-agent 目录内");
  }
  const { InvokeId } = api("SendFile", {
    "InstanceId.1": instance, Name: path.basename(target), TargetDir: path.dirname(target),
    Content: content.toString("base64"), ContentType: "Base64", FileMode: "0600", Overwrite: false,
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    await pause();
    const result = api("DescribeSendFileResults", { InvokeId })
      .Invocations?.Invocation?.[0]?.InvokeInstances?.InvokeInstance?.[0];
    if (result?.InvocationStatus === "Success") return;
    if (result && !["Pending", "Running", "Scheduled"].includes(result.InvocationStatus)) {
      throw new Error(`文件发送失败：${result.InvocationStatus}`);
    }
  }
  throw new Error(`文件发送尚未确认，请查询 ${InvokeId}`);
}
const [action, source, target] = process.argv.slice(2);
if (action === "run") {
  await run(readFileSync(source, "utf8"));
} else if (action === "send") {
  const bytes = readFileSync(source);
  if (bytes.length > 24000) throw new Error("单文件超过云助手限制，请使用 bundle");
  await send(bytes, target);
  console.log("文件已送达，未输出文件内容。");
} else if (action === "bundle") {
  const bytes = readFileSync(source);
  if (!/^\/opt\/cfp-hello-agent\/releases\/[a-zA-Z0-9_-]+$/.test(target)) {
    throw new Error("归档目标必须为独立的新版本目录");
  }
  const count = Math.ceil(bytes.length / 24000);
  for (let index = 0; index < count; index++) {
    await send(bytes.subarray(index * 24000, (index + 1) * 24000), `${target}/parts/part-${String(index).padStart(4, "0")}`);
    console.log(`已传输 ${index + 1}/${count}`);
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  await run(`set -eu\ncd '${target}'\ncat parts/part-* > source.tar.gz\nprintf '%s  source.tar.gz\\n' '${sha}' | sha256sum -c -\nmkdir source\ntar -xzf source.tar.gz -C source\n`);
} else {
  throw new Error("用法：ecs-preview.mjs run 脚本 | send 文件 目标 | bundle 归档 新版本目录");
}
