import { spawnSync } from "node:child_process";
import console from "node:console";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
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
  // WXSS has no HTML :root node. The native compiler silently drops that
  // selector and rewrites the native `page` selector to `body`, so variables
  // must be asserted on that complete rule in compiled output, not by a bare
  // token search (which could match the orphan declaration).
  const compiled = readFileSync(path.join(output, "compiled.js"), "utf8")
    .replaceAll("%%HERESUFFIX%%", "")
    .replace(/%%\?([^?]+)\?%%/g, "$1");
  const rules = new Map(
    [...compiled.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [
      match[1].trim(),
      match[2],
    ]),
  );
  const nativeScope = rules.get("body") || "";
  const themeTokens = [
    "text",
    "muted",
    "accent",
    "accent-soft",
    "border",
    "panel",
    "danger",
  ];
  if (
    !themeTokens.every((token) =>
      nativeScope.includes(`--chat-ui-${token}:`),
    )
  )
    throw new Error(
      "原生 WXSS 输出缺少 page 作用域的 chat-ui 主题变量；样式编译通过不等于运行时变量可用。",
    );
  const missingFallbacks = [...compiled.matchAll(/var\((--chat-ui-[\w-]+)([^)]*)\)/g)]
    .filter((match) => !match[2].includes(","))
    .map((match) => match[1]);
  if (missingFallbacks.length)
    throw new Error(
      `RootPortal 样式变量缺少回退值：${[...new Set(missingFallbacks)].join(", ")}`,
    );
  for (const selector of [
    ".control",
    ".control.artifact-submit",
    ".control.detail-close",
  ]) {
    if (!rules.has(selector))
      throw new Error(`原生 WXSS 输出缺少弹层控件样式：${selector}`);
  }
  console.log(
    `微信原生 WXSS 编译通过：${files.length} 个样式文件。此检查不替代上传或真机验收。`,
  );
} finally {
  // 仅删除本脚本刚创建的编译临时目录，不触碰项目或用户数据。
  rmSync(output, { recursive: true, force: true });
}
