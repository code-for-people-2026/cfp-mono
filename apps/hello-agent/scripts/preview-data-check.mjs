import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const compose = readFileSync(new URL("../deploy/compose.preview.yml", import.meta.url), "utf8");
assert.match(compose, /data-init:\s*\n\s*condition: service_completed_successfully/, "应用必须等待数据目录准备成功");
assert.match(compose, /chown node:node \/data/, "由镜像内的 node 用户确定目录归属");
assert.match(compose, /chmod 0700 \/data/, "数据库目录不向其他用户开放");
console.log("✓ 数据目录初始化与启动依赖的部署约定完整");

if (!process.argv.includes("--docker")) {
  console.log("本机只检查部署约定；真实权限与 SQLite 写入由 CI 的 --docker 检查覆盖。");
} else {
  // 只使用临时夹具和镜像，不连接 ECS，不读取真实配置或数据库。
  const fixture = mkdtempSync(path.join(tmpdir(), "hello-preview-data-"));
  const project = path.basename(fixture).toLowerCase();
  const image = `${project}:test`;
  const docker = (args) => execFileSync("docker", args, { encoding: "utf8", timeout: 120_000, stdio: "pipe" });
  const composePath = path.join(fixture, "compose.json");
  const commands = ["compose", "-p", project, "-f", composePath];
  try {
    const dockerfile = readFileSync(new URL("../Dockerfile.preview", import.meta.url), "utf8");
    const base = dockerfile.match(/^FROM (\S+)/m)?.[1];
    assert.ok(base, "使用预览镜像同一基础镜像");
    assert.match(dockerfile, /^USER node$/m, "应用仍以非特权用户运行");
    writeFileSync(path.join(fixture, "Dockerfile"), `FROM ${base}\nUSER node\n`);
    docker(["build", "-t", image, fixture]);
    mkdirSync(path.join(fixture, "private"));
    for (const name of ["runtime.env", "oss.env"])
      writeFileSync(path.join(fixture, "private", name), "");
    const source = path.join(fixture, "compose.yml");
    writeFileSync(source, compose.replaceAll("/opt/cfp-hello-agent", fixture));
    const config = JSON.parse(execFileSync("docker", ["compose", "-p", project, "-f", source, "config", "--format", "json"], {
      encoding: "utf8", timeout: 30_000, env: { ...process.env, HELLO_PREVIEW_IMAGE: image },
    }));
    const app = config.services.app;
    // 保留真实挂载、安全选项及启动依赖，只把应用替换成最小 SQLite 写入探针。
    delete app.ports;
    delete app.healthcheck;
    app.restart = "no";
    app.command = ["node", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { DatabaseSync } from 'node:sqlite';
      assert.notEqual(process.getuid(), 0);
      const db = new DatabaseSync('/data/hello.db');
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY); INSERT INTO visits DEFAULT VALUES');
      console.log('ROWS=' + db.prepare('SELECT COUNT(*) AS total FROM visits').get().total);
      db.close();
    `];
    for (const service of Object.values(config.services))
      for (const volume of service.volumes || [])
        assert.ok(volume.source.startsWith(`${fixture}/`), "绝不挂载真实服务器数据路径");
    writeFileSync(composePath, JSON.stringify(config));

    // 负对照：移除初始化依赖，Docker 在新机器上创建的 root 目录必须复现原故障。
    const broken = structuredClone(config);
    delete broken.services.app.depends_on;
    delete broken.services["data-init"];
    broken.services.app.volumes[0].source = path.join(fixture, "unprepared-data");
    const brokenPath = path.join(fixture, "broken.json");
    writeFileSync(brokenPath, JSON.stringify(broken));
    const result = spawnSync("docker", ["compose", "-p", project, "-f", brokenPath, "run", "--rm", "-T", "--no-deps", "app"], {
      encoding: "utf8", timeout: 120_000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0, "未准备的 root 目录必须无法写库，保证回归能够检出原问题");
    assert.match(result.stderr, /unable to open database file/);
    console.log("✓ 负对照复现：root 归属的空目录使非特权应用无法创建 SQLite");

    assert.match(docker([...commands, "run", "--rm", "-T", "app"]), /ROWS=1/);
    assert.match(docker([...commands, "run", "--rm", "-T", "app"]), /ROWS=2/);
    console.log("✓ 全新部署可写 SQLite，重复部署保留旧数据，应用始终非 root");

    const blocked = structuredClone(config);
    blocked.services["data-init"].command = ["sh", "-ec", "exit 42"];
    docker([...commands, "down"]);
    writeFileSync(composePath, JSON.stringify(blocked));
    const denied = spawnSync("docker", [...commands, "run", "--rm", "-T", "app"], { encoding: "utf8", timeout: 120_000 });
    assert.equal(denied.error, undefined);
    assert.notEqual(denied.status, 0, "目录准备失败时应用不能继续启动");
    docker([...commands, "down"]);
    writeFileSync(composePath, JSON.stringify(config));
    assert.match(docker([...commands, "run", "--rm", "-T", "app"]), /ROWS=3/);
    console.log("✓ 初始化失败阻止启动，修复后恢复且数据未丢失");
  } finally {
    if (spawnSync("docker", [...commands, "down"], { timeout: 30_000, stdio: "pipe" }).status !== 0)
      console.warn(`请检查临时 Compose 项目 ${project} 的清理结果`);
    // 测试数据库由容器用户创建，使用同一夹具镜像清理这个已验证的临时路径。
    spawnSync("docker", ["run", "--rm", "--user", "0:0", "--mount", `type=bind,src=${fixture},dst=/fixture`, image,
      "node", "-e", "for (const name of ['data', 'unprepared-data']) require('node:fs').rmSync('/fixture/' + name, {recursive:true, force:true})"], { timeout: 30_000, stdio: "pipe" });
    spawnSync("docker", ["image", "rm", image], { timeout: 30_000, stdio: "pipe" });
    rmSync(fixture, { recursive: true, force: true });
  }
}
