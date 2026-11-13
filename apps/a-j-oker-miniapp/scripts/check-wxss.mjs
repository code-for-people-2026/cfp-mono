import { spawnSync } from "node:child_process";
import console from "node:console";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

// Taro 构建不执行微信的原生样式编译；上传前单独检查实际产物。
const compiler =
  process.env.HELLO_WXSS_COMPILER ||
  "/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcsc";
if (!existsSync(compiler)) {
  throw new Error(
    "缺少微信样式编译器，请安装开发者工具或设置 HELLO_WXSS_COMPILER；不能跳过后声称校验通过。",
  );
}
const root = fileURLToPath(new URL("../dist/weapp/", import.meta.url));
function styles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? styles(file)
      : entry.name.endsWith(".wxss")
        ? [path.relative(root, file)]
        : [];
  });
}
const files = styles(root).sort();
if (!files.includes("app.wxss")) throw new Error("请先构建微信小程序产物。");
const output = mkdtempSync(path.join(tmpdir(), "aj-wxss-check-"));
try {
  const result = spawnSync(
    compiler,
    [...files, "-o", path.join(output, "compiled.js")],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`微信 WXSS 编译失败：\n${result.stderr || result.stdout}`);
  }
  console.log(
    `微信原生 WXSS 编译通过：${files.length} 个样式文件。此检查不替代上传或真机验收。`,
  );
} finally {
  // 仅删除本脚本刚创建的编译临时目录，不触碰项目或用户数据。
  rmSync(output, { recursive: true, force: true });
}
