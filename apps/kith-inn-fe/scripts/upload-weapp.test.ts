import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultRuntime, parseUploadArgs, runUploadWeapp, validateSmokeMarker } from "./upload-weapp";

const sha = "1234567890abcdef1234567890abcdef12345678";
const checks = ["cms_liveness", "cms_readiness", "be_liveness", "be_readiness", "h5",
  "be_ingress_liveness", "be_ingress_readiness", "be_ingress_auth_boundary", "operator", "jwt", "offerings"];
const marker = {
  markerSchemaVersion: 1, releaseSha: sha, deployRunId: "42",
  cmsImageDigest: `sha256:${"1".repeat(64)}`, cmsOpsImageDigest: `sha256:${"2".repeat(64)}`,
  beImageDigest: `sha256:${"3".repeat(64)}`, h5ImageDigest: `sha256:${"4".repeat(64)}`,
  schemaMigrationHead: "20260714_initial", backupId: "9", backupCreatedAt: "2026-07-15T15:00:00Z",
  startedAt: "2026-07-15T17:00:00Z", durationMs: 10, checks, writeCount: 0,
  redactionPassed: true, smokeStatus: "passed",
};
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });

function project() {
  const root = mkdtempSync(join(tmpdir(), "kith-upload-test-")); roots.push(root);
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist", "app.js"), "release");
  mkdirSync(join(root, "dist", "pages")); writeFileSync(join(root, "dist", "pages", "index.js"), "page");
  writeFileSync(join(root, "project.config.json"), JSON.stringify({
    miniprogramRoot: "dist/", compileType: "miniprogram", setting: { urlCheck: true },
  }));
  return root;
}

describe("upload arguments and smoke credential", () => {
  it("keeps the manual workflow bound to main and an unexpired deployment run", () => {
    const workflow = readFileSync(join(__dirname, "../../../.github/workflows/release-kith-inn-weapp.yml"), "utf8");
    for (const token of ["GITHUB_REF\" == refs/heads/main", "git merge-base --is-ancestor", ".expired == false",
      ".workflow_run.head_sha", ".workflow_run.head_branch == \"main\"", ".name == \"Deploy Production\"",
      "actions/download-artifact@v4", "environment: Production"])
      expect(workflow).toContain(token);
  });
  it("requires version/description/project path and rejects unknown arguments", () => {
    expect(parseUploadArgs(["--", "--version", "1.2.3", "--desc", `trial-${sha.slice(0, 12)}`, "--project-path", "/tmp/p", "--dry-run"]))
      .toMatchObject({ version: "1.2.3", dryRun: true });
    expect(() => parseUploadArgs([])).toThrow("上传参数无效");
    expect(() => parseUploadArgs(["--unknown"])).toThrow("上传参数无效");
    expect(parseUploadArgs(["--marker-only", "--marker", "/tmp/marker"]).markerOnly).toBe(true);
    expect(() => parseUploadArgs(["--marker-only"])).toThrow("上传参数无效");
    for (const argv of [
      ["--version", "!"], ["--version", "1", "--desc", "x"],
      ["--version", "1", "--desc", "x\n", "--project-path", "/tmp/p"],
      ["--version", "1", "--desc", "x".repeat(65), "--project-path", "/tmp/p"],
      ["--version"], ["--version", "1", "--desc", `trial-${sha.slice(0, 12)}`, "--project-path", "/tmp/p"],
    ]) expect(() => parseUploadArgs(argv)).toThrow("上传参数无效");
  });
  it("binds a complete passed marker to the selected SHA and deployment run", () => {
    expect(validateSmokeMarker(marker, sha, "42").releaseSha).toBe(sha);
    for (const patch of [
      { releaseSha: "a".repeat(40) }, { deployRunId: "43" }, { cmsImageDigest: "sha256:bad" },
      { cmsOpsImageDigest: "sha256:bad" }, { beImageDigest: "sha256:bad" },
      { h5ImageDigest: "sha256:bad" }, { schemaMigrationHead: "bad head" }, { smokeStatus: "failed" },
      { markerSchemaVersion: 2 }, { checks: [] }, { writeCount: 1 }, { redactionPassed: false },
      { backupId: "bad" }, { backupCreatedAt: "local" }, { startedAt: "local" },
      { durationMs: -1 }, { durationMs: 1.5 },
    ]) expect(() => validateSmokeMarker({ ...marker, ...patch }, sha, "42")).toThrow("smoke marker 无效");
    for (const key of ["cmsImageDigest", "schemaMigrationHead", "backupId", "backupCreatedAt", "startedAt"])
      expect(() => validateSmokeMarker({ ...marker, [key]: undefined }, sha, "42")).toThrow("smoke marker 无效");
    expect(() => validateSmokeMarker(null, sha, "42")).toThrow("smoke marker 无效");
    expect(() => validateSmokeMarker("bad", sha, "42")).toThrow("smoke marker 无效");
    expect(() => validateSmokeMarker(marker, "bad", "42")).toThrow("smoke marker 无效");
    expect(() => validateSmokeMarker(marker, sha, "0")).toThrow("smoke marker 无效");
  });
});
describe("runUploadWeapp", () => {
  const baseEnv = { RELEASE_SHA: sha, BE_BASE_URL: "https://codeforpeople.cn" };

  it("produces the same digest twice in dry-run and never loads the SDK", async () => {
    const root = project(); const loadCi = vi.fn();
    const args = { version: "1.2.3", desc: `trial-${sha.slice(0, 12)}`, projectPath: root, dryRun: true };
    const first = await runUploadWeapp(args, baseEnv, { loadCi });
    const second = await runUploadWeapp(args, baseEnv, { loadCi });
    expect(first).toEqual(second); expect(first.buildDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(loadCi).not.toHaveBeenCalled();
  });
  it("fails before SDK use for illegal URL, SHA, description or project config", async () => {
    const root = project(); const loadCi = vi.fn();
    const args = { version: "1.2.3", desc: `trial-${sha.slice(0, 12)}`, projectPath: root, dryRun: true };
    for (const env of [{ ...baseEnv, BE_BASE_URL: "http://localhost" }, { ...baseEnv, RELEASE_SHA: "bad" },
      { BE_BASE_URL: baseEnv.BE_BASE_URL }])
      await expect(runUploadWeapp(args, env, { loadCi })).rejects.toThrow();
    await expect(runUploadWeapp({ ...args, desc: "trial" }, baseEnv, { loadCi })).rejects.toThrow("上传参数无效");
    for (const config of ["bad json", '{"compileType":"miniprogram","miniprogramRoot":"bad","setting":{"urlCheck":true}}',
      '{"compileType":"bad","miniprogramRoot":"dist/","setting":{"urlCheck":true}}',
      '{"compileType":"miniprogram","miniprogramRoot":"dist/","setting":{"urlCheck":false}}']) {
      writeFileSync(join(root, "project.config.json"), config);
      await expect(runUploadWeapp(args, baseEnv, { loadCi })).rejects.toThrow("项目配置无效");
    }
    expect(loadCi).not.toHaveBeenCalled();
  });
  it("rejects an empty or linked build and missing upload credentials", async () => {
    const root = project(); const args = { version: "1", desc: `trial-${sha.slice(0, 12)}`, projectPath: root, dryRun: true };
    rmSync(join(root, "dist", "app.js")); rmSync(join(root, "dist", "pages"), { recursive: true });
    await expect(runUploadWeapp(args, baseEnv, { loadCi: vi.fn() })).rejects.toThrow("项目配置无效");
    symlinkSync(root, join(root, "dist", "linked"));
    await expect(runUploadWeapp(args, baseEnv, { loadCi: vi.fn() })).rejects.toThrow("项目配置无效");
    rmSync(join(root, "dist", "linked")); writeFileSync(join(root, "dist", "app.js"), "release");
    for (const env of [{ ...baseEnv }, { ...baseEnv, WX_APPID: "wx1234567890abcdef" },
      { ...baseEnv, WX_APPID: "wx1234567890abcdef", KITH_INN_MINIPROGRAM_PRIVATE_KEY: "BEGIN PRIVATE KEY" }])
      await expect(runUploadWeapp({ ...args, dryRun: false }, env, { loadCi: vi.fn() })).rejects.toThrow("上传凭据无效");
  });

  it("uses a 0600 temporary key and removes it after upload", async () => {
    const root = project(); let keyPath = "";
    const upload = vi.fn(async () => ({}));
    const Project = vi.fn(function (options: { privateKeyPath: string }) {
      keyPath = options.privateKeyPath;
      expect(statSync(keyPath).mode & 0o777).toBe(0o600);
      expect(readFileSync(keyPath, "utf8")).toContain("BEGIN PRIVATE KEY");
    });
    const result = await runUploadWeapp(
      { version: "1.2.3", desc: `trial-${sha.slice(0, 12)}`, projectPath: root, dryRun: false },
      { ...baseEnv, WX_APPID: "wx1234567890abcdef", KITH_INN_MINIPROGRAM_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----", KITH_INN_MINIPROGRAM_IP_WHITELIST_ENABLED: "true" },
      { loadCi: async () => ({ Project, upload }) },
    );
    expect(result.status).toBe("uploaded"); expect(upload).toHaveBeenCalledOnce(); expect(upload).toHaveBeenCalledWith(expect.objectContaining({ setting: { useProjectConfig: true } }));
    expect(() => statSync(keyPath)).toThrow();
  });

  it("removes the key and hides SDK errors", async () => {
    const root = project(); let keyPath = "";
    const Project = vi.fn(function (options: { privateKeyPath: string }) { keyPath = options.privateKeyPath; });
    const upload = vi.fn(async () => { throw new Error("sdk-secret-sentinel"); });
    const promise = runUploadWeapp(
      { version: "1.2.3", desc: `trial-${sha.slice(0, 12)}`, projectPath: root, dryRun: false },
      { ...baseEnv, WX_APPID: "wx1234567890abcdef", KITH_INN_MINIPROGRAM_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nsecret", KITH_INN_MINIPROGRAM_IP_WHITELIST_ENABLED: "true" },
      { loadCi: async () => ({ Project, upload }) },
    );
    await expect(promise).rejects.toThrow("微信体验版上传失败");
    await expect(promise).rejects.not.toThrow("sdk-secret-sentinel");
    expect(() => statSync(keyPath)).toThrow();
  });

  it("hides SDK loading errors", async () => {
    const root = project();
    await expect(runUploadWeapp(
      { version: "1", desc: `trial-${sha.slice(0, 12)}`, projectPath: root, dryRun: false },
      { ...baseEnv, WX_APPID: "wx1234567890abcdef", KITH_INN_MINIPROGRAM_PRIVATE_KEY: "BEGIN PRIVATE KEY", KITH_INN_MINIPROGRAM_IP_WHITELIST_ENABLED: "true" },
      { loadCi: async () => { throw new Error("load-secret"); } },
    )).rejects.toThrow("微信体验版上传失败");
  });

  it("loads the locked SDK through the default runtime", async () => {
    const ci = await defaultRuntime.loadCi();
    expect(ci.Project).toBeTypeOf("function"); expect(ci.upload).toBeTypeOf("function");
  });
});
