import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { productionBeBaseUrl } from "../config/production";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const CHECKS = ["cms_liveness", "cms_readiness", "be_liveness", "be_readiness", "h5",
  "be_ingress_liveness", "be_ingress_readiness", "be_ingress_auth_boundary", "operator", "jwt", "offerings"];
const invalidArgs = (): never => { throw new Error("上传参数无效"); };

interface UploadArgs {
  version: string; desc: string; projectPath: string; dryRun: boolean;
  markerPath?: string; markerOnly?: boolean;
}
interface SmokeMarker { releaseSha: string; deployRunId: string; [key: string]: unknown }
interface CiModule {
  Project: new (options: { appid: string; type: "miniProgram"; projectPath: string; privateKeyPath: string }) => unknown;
  upload(options: { project: unknown; version: string; desc: string; setting: { useProjectConfig: true } }): Promise<unknown>;
}
interface Runtime { loadCi(): Promise<CiModule> }

export function parseUploadArgs(argv: string[]): UploadArgs {
  const values: Record<string, string> = {}; let dryRun = false; let markerOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (name === "--") continue;
    if (name === "--dry-run") { dryRun = true; continue; }
    if (name === "--marker-only") { markerOnly = true; continue; }
    if (!["--version", "--desc", "--project-path", "--marker"].includes(name) || !argv[index + 1]) invalidArgs();
    values[name] = argv[index + 1]!; index += 1;
  }
  const version = values["--version"] ?? ""; const desc = values["--desc"] ?? "";
  const projectPath = values["--project-path"] ?? ""; const markerPath = values["--marker"];
  if (markerOnly && !markerPath) invalidArgs();
  if (!markerOnly && (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/.test(version) || !desc || desc.length > 64 || /[\r\n]/.test(desc) || !projectPath)) invalidArgs();
  return { version, desc, projectPath: projectPath ? resolve(projectPath) : "", dryRun, markerPath, markerOnly };
}

export function validateSmokeMarker(input: unknown, expectedSha: string, expectedRunId: string): SmokeMarker {
  const marker = input as Record<string, unknown>;
  const digests = ["cmsImageDigest", "cmsOpsImageDigest", "beImageDigest", "h5ImageDigest"];
  const valid = marker && typeof marker === "object" && marker.markerSchemaVersion === 1 &&
    SHA.test(expectedSha) && marker.releaseSha === expectedSha && /^[1-9][0-9]*$/.test(expectedRunId) &&
    marker.deployRunId === expectedRunId && digests.every((name) => DIGEST.test(String(marker[name] ?? ""))) &&
    /^[A-Za-z0-9_]+$/.test(String(marker.schemaMigrationHead ?? "")) && /^[0-9]+$/.test(String(marker.backupId ?? "")) &&
    UTC.test(String(marker.backupCreatedAt ?? "")) && UTC.test(String(marker.startedAt ?? "")) &&
    Number.isInteger(marker.durationMs) && Number(marker.durationMs) >= 0 &&
    JSON.stringify(marker.checks) === JSON.stringify(CHECKS) && marker.writeCount === 0 &&
    marker.redactionPassed === true && marker.smokeStatus === "passed";
  if (!valid) throw new Error("smoke marker 无效");
  return marker as SmokeMarker;
}

function buildDigest(projectPath: string): string {
  const root = join(projectPath, "dist"); const files: string[] = [];
  const walk = (dir: string) => readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path); else if (entry.isFile()) files.push(path); else throw new Error("项目配置无效");
  });
  walk(root); if (!files.length) throw new Error("项目配置无效");
  const hash = createHash("sha256");
  files.sort().forEach((file) => hash.update(relative(root, file)).update("\0").update(readFileSync(file)));
  return `sha256:${hash.digest("hex")}`;
}

export async function runUploadWeapp(args: UploadArgs, env: Record<string, string | undefined>, runtime: Runtime) {
  const releaseSha = env.RELEASE_SHA ?? ""; productionBeBaseUrl(env.BE_BASE_URL);
  if (!SHA.test(releaseSha) || !args.desc.includes(releaseSha.slice(0, 12))) invalidArgs();
  let config: { miniprogramRoot?: string; compileType?: string; setting?: { urlCheck?: boolean } };
  try { config = JSON.parse(readFileSync(join(args.projectPath, "project.config.json"), "utf8")); }
  catch { throw new Error("项目配置无效"); }
  if (config.miniprogramRoot !== "dist/" || config.compileType !== "miniprogram" || config.setting?.urlCheck !== true) throw new Error("项目配置无效");
  const result = { status: args.dryRun ? "dry-run" : "uploaded", releaseSha, version: args.version, buildDigest: buildDigest(args.projectPath) };
  if (args.dryRun) return result;
  const appid = env.WX_APPID?.trim() ?? ""; const privateKey = env.KITH_INN_MINIPROGRAM_PRIVATE_KEY ?? "";
  if (!/^wx[0-9a-z]{16}$/i.test(appid) || !privateKey.includes("BEGIN PRIVATE KEY") ||
    env.KITH_INN_MINIPROGRAM_IP_WHITELIST_ENABLED !== "true") throw new Error("上传凭据无效");
  const keyDir = mkdtempSync(join(tmpdir(), "kith-inn-weapp-"));
  try {
    chmodSync(keyDir, 0o700);
    const privateKeyPath = join(keyDir, "private.key"); writeFileSync(privateKeyPath, privateKey, { mode: 0o600 }); chmodSync(privateKeyPath, 0o600);
    const ci = await runtime.loadCi();
    const project = new ci.Project({ appid, type: "miniProgram", projectPath: args.projectPath, privateKeyPath });
    await ci.upload({ project, version: args.version, desc: args.desc, setting: { useProjectConfig: true } });
    return result;
  } catch {
    throw new Error("微信体验版上传失败");
    /* v8 ignore next -- Vitest/V8 将已覆盖的 catch 结束符误计为额外分支。 */
  }
  finally { rmSync(keyDir, { force: true, recursive: true }); }
}

export const defaultRuntime: Runtime = {
  loadCi: async () => import("miniprogram-ci") as unknown as Promise<CiModule>,
};
