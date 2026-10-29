import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";

const app = fileURLToPath(new URL("..", import.meta.url));
const root = path.resolve(app, "../..");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const version = process.env.HELLO_RELEASE_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version || ""))
  throw new Error("请提供 HELLO_RELEASE_VERSION");
if (!/^https:\/\//.test(process.env.HELLO_API_ORIGIN || ""))
  throw new Error("发布必须指定 HTTPS 测试服务");
git("fetch", "origin", "main");
git("merge-base", "--is-ancestor", "origin/main", "HEAD");
const sources = [
  "apps/hello-agent",
  "apps/hello-agent-miniapp",
  "packages/hello-agent-contracts",
  "packages/hello-agent-protocol",
  "packages/typescript-config",
  "packages/eslint-config",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package.json",
  "patches",
];
if (git("status", "--porcelain", "--", ...sources))
  throw new Error("发布来源必须先提交，不能用未记录的本地改动打包");
const commit = git("rev-parse", "HEAD");
const env = { ...process.env, HELLO_RELEASE_COMMIT: commit };
execFileSync("pnpm", ["build"], { cwd: app, env, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/check-release.mjs"], {
  cwd: app,
  stdio: "inherit",
});
const info = {
  version,
  commit,
  base: git("rev-parse", "origin/main"),
  builtAt: new Date().toISOString(),
};
for (const target of ["h5", "weapp"])
  writeFileSync(
    path.join(app, `dist/${target}/build-info.json`),
    JSON.stringify(info, null, 2) + "\n",
  );
execFileSync(process.execPath, ["scripts/sync-miniapp.mjs"], {
  cwd: path.join(root, "apps/hello-agent"),
  stdio: "inherit",
});
console.log(`发布包已校验：${version} / ${commit}`);
