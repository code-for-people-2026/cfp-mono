import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dockerignore from "@balena/dockerignore";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const specific = path.join(
  root,
  "apps/hello-agent/Dockerfile.preview.dockerignore",
);
// Dockerfile 专属规则优先；读取真正参与构建的规则，不读取任何私密文件内容。
const rules = readFileSync(
  existsSync(specific) ? specific : path.join(root, ".dockerignore"),
  "utf8",
);
const filter = dockerignore().add(rules);
const forbidden = [
  "apps/hello-agent/.data/hello.db",
  "apps/hello-agent/.data/hello.db-wal",
  "apps/hello-agent/.data/secret",
  "apps/hello-agent/.data/ecs-preview/private/runtime.env",
  "apps/hello-agent/.data/ecs-preview/private/oss.env",
  "apps/hello-agent/.data/ecs-preview/private/admin.env",
  "apps/hello-agent/.data/ecs-preview/private/privkey.pem",
  "apps/hello-agent/.data/ecs-preview/access.txt",
  "apps/hello-agent/.data/ecs-preview/private.tar.gz",
  "apps/hello-agent/.env.local",
];
assert.deepEqual(
  filter.filter(forbidden),
  [],
  "构建上下文不得包含数据库、凭证或私密归档",
);
const required = [
  "apps/hello-agent/package.json",
  "apps/hello-agent/payload.config.ts",
  "apps/hello-agent/src/cms/migrations/index.ts",
  "apps/hello-agent/public/chat/index.html",
  "apps/hello-agent/.env.example",
];
assert.deepEqual(
  filter.filter(required),
  required,
  "构建所需源码与 H5 必须仍可进入上下文",
);
console.log("✓ 构建上下文过滤：私密数据被排除，源码和 H5 保留");
if (process.argv.includes("--docker")) {
  // CI 用真实 Docker 验证 COPY，只创建虚拟路径和无敏感内容的夹具，绝不发送真实工作目录。
  const fixture = mkdtempSync(path.join(tmpdir(), "hello-image-context-"));
  const context = path.join(fixture, "context");
  const output = path.join(fixture, "output");
  try {
    for (const file of [...forbidden, ...required]) {
      const target = path.join(context, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, "synthetic-build-context-fixture");
    }
    writeFileSync(path.join(context, ".dockerignore"), rules);
    writeFileSync(
      path.join(context, "Dockerfile"),
      "FROM scratch\nCOPY . /proof\n",
    );
    execFileSync(
      "docker",
      ["build", "--output", `type=local,dest=${output}`, context],
      {
        env: { ...process.env, DOCKER_BUILDKIT: "1" },
        timeout: 60_000,
        stdio: "pipe",
      },
    );
    for (const file of forbidden)
      assert.equal(existsSync(path.join(output, "proof", file)), false, file);
    for (const file of required)
      assert.equal(existsSync(path.join(output, "proof", file)), true, file);
    console.log("✓ 真实 Docker COPY 的导出文件不含私密夹具，所需源码保留");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
} else {
  console.log(
    "本机只检查过滤规则；实际 Docker COPY 由 CI 的 --docker 检查覆盖。",
  );
}
