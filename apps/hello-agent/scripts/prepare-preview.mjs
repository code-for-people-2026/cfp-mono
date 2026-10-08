import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 生成物全在被 Git 忽略的私密目录；不复制本机数据库、访客或管理员。
const app = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(app, ".data/ecs-preview");
const privateDir = path.join(output, "private");
const origin = new URL(process.env.HELLO_PREVIEW_ORIGIN);
const address = process.env.HELLO_PREVIEW_ALLOWED_IP;
if (origin.protocol !== "https:" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(address || "")) {
  throw new Error("必须提供 HTTPS 测试域名和当前开发网络的出口 IPv4");
}
const release = process.env.HELLO_RELEASE;
if (!/^[a-z0-9_-]+$/.test(release || "")) throw new Error("缺少版本号");
loadEnvFile(path.join(app, ".env.local"));
if (!process.env.DEEPSEEK_API_KEY) throw new Error("缺少平台模型凭证");
mkdirSync(privateDir, { recursive: true, mode: 0o700 });
chmodSync(output, 0o700);
const write = (name, text) => writeFileSync(path.join(privateDir, name), text, { flag: "wx", mode: 0o600 });
const password = randomBytes(24).toString("base64url");
const email = process.env.HELLO_PREVIEW_ADMIN_EMAIL || "aj-admin@preview.invalid";
write("runtime.env", [
  "NODE_ENV=production", "HELLO_DEPLOYED=true", "HELLO_DATABASE_URI=file:/data/hello.db",
  `PAYLOAD_SECRET=${randomBytes(48).toString("hex")}`, `HELLO_ORIGIN=${origin.origin}`,
  `DEEPSEEK_API_KEY=${process.env.DEEPSEEK_API_KEY}`, `HELLO_MODEL=${process.env.HELLO_MODEL || "deepseek-flash"}`,
  "HELLO_ADMIN_BOOTSTRAP=false", "HELLO_AD_MODE=disabled", "HELLO_MEMORY_RECOVERY=preview", `HELLO_RELEASE=${release}`, "",
].join("\n"));
write("admin.env", `HELLO_ADMIN_EMAIL=${email}\nHELLO_ADMIN_PASSWORD=${password}\n`);
const certDir = process.env.HELLO_PREVIEW_CERT_DIR;
if (!certDir) throw new Error("缺少本次签发的证书目录");
copyFileSync(path.join(certDir, "fullchain.cer"), path.join(privateDir, "fullchain.pem"));
copyFileSync(path.join(certDir, `${origin.hostname}.key`), path.join(privateDir, "privkey.pem"));
chmodSync(path.join(privateDir, "privkey.pem"), 0o600);
write("aj-preview.conf", `# 独立测试入口；不修改官网，不开放服务端口，不记录请求体。\nserver {\n  listen 80;\n  server_name ${origin.hostname};\n  return 308 https://${origin.hostname}$request_uri;\n}\nserver {\n  listen 443 ssl http2;\n  server_name ${origin.hostname};\n  ssl_certificate /opt/cfp-hello-agent/private/fullchain.pem;\n  ssl_certificate_key /opt/cfp-hello-agent/private/privkey.pem;\n  ssl_protocols TLSv1.2 TLSv1.3;\n  allow ${address};\n  allow 127.0.0.1;\n  deny all;\n  client_max_body_size 8m;\n  add_header X-Robots-Tag "noindex, nofollow, noarchive" always;\n  add_header X-Content-Type-Options nosniff always;\n  location / {\n    proxy_pass http://127.0.0.1:3310;\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $remote_addr;\n    proxy_set_header X-Forwarded-Proto https;\n    proxy_read_timeout 120s;\n  }\n}\n`);
writeFileSync(path.join(output, "access.txt"), `好人阿 J · 私有联调环境\n地址：${origin.origin}\n管理后台：${origin.origin}/admin\n管理员：${email}\n密码：${password}\n允许的开发出口 IP：${address}\n请勿分享本文件。并非正式上线，不适用于公众访问。\n`, { flag: "wx", mode: 0o600 });
execFileSync("tar", ["-czf", path.join(output, "private.tar.gz"), "-C", privateDir, "runtime.env", "admin.env", "fullchain.pem", "privkey.pem", "aj-preview.conf"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
chmodSync(path.join(output, "private.tar.gz"), 0o600);
console.log("已生成独立测试配置与管理员信息，全部保存在 .data/ecs-preview；未输出任何密码。");
