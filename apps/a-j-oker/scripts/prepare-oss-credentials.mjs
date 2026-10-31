import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// 经用户确认复用部署账号：明文仅驻留本机进程内存，云助手只传输加密信封。
const [certificate, output] = process.argv.slice(2);
const bucket = process.env.HELLO_OSS_BUCKET;
if (!certificate || !output || !bucket || !/^[a-z0-9-]+$/.test(bucket))
  throw new Error("需要服务器接收证书、加密输出路径与目标桶名称");
const config = JSON.parse(readFileSync(path.join(homedir(), ".aliyun/config.json"), "utf8"));
const profile = config.profiles?.find((item) => item.name === "cfp-deploy");
if (profile?.mode !== "AK" || !/^[A-Za-z0-9]+$/.test(profile.access_key_id || "") ||
    !/^[A-Za-z0-9]+$/.test(profile.access_key_secret || ""))
  throw new Error("部署配置不是可识别的 AK 凭证，未导出任何内容");
const body = [
  "HELLO_MEDIA_STORAGE=oss", `HELLO_OSS_BUCKET=${bucket}`,
  "HELLO_OSS_REGION=oss-cn-shenzhen", "HELLO_OSS_INTERNAL=true",
  `HELLO_OSS_ACCESS_KEY_ID=${profile.access_key_id}`,
  `HELLO_OSS_ACCESS_KEY_SECRET=${profile.access_key_secret}`, "",
].join("\n");
try {
  execFileSync("openssl", ["cms", "-encrypt", "-binary", "-aes256", "-outform", "DER", "-out", output, certificate], { input: body, stdio: ["pipe", "pipe", "pipe"] });
} catch { throw new Error("凭证加密失败，未输出凭证"); }
console.log("已生成加密凭证信封，未输出密钥。");
