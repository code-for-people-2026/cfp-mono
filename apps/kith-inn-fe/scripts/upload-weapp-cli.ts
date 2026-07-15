import { readFileSync } from "node:fs";
import { defaultRuntime, parseUploadArgs, runUploadWeapp, validateSmokeMarker } from "./upload-weapp";

async function main() {
  try {
    const args = parseUploadArgs(process.argv.slice(2));
    if (args.markerPath) {
      const marker = JSON.parse(readFileSync(args.markerPath, "utf8"));
      validateSmokeMarker(marker, process.env.RELEASE_SHA ?? "", process.env.SMOKE_DEPLOY_RUN_ID ?? "");
    }
    const result = args.markerOnly ? { status: "marker-valid", releaseSha: process.env.RELEASE_SHA } :
      await runUploadWeapp(args, process.env, defaultRuntime);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "体验版上传失败");
    process.exitCode = 1;
  }
}

void main();
