import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";

// Optional browser check; use an installed Playwright module (or its absolute
// module path). It loads the real application and Taro styles, without models.
const { chromium } = await import(process.env.HELLO_PLAYWRIGHT_MODULE || "playwright");
const require = createRequire(import.meta.url);
const taro = path.dirname(require.resolve("@tarojs/components/package.json"));
const component = await readFile(path.join(taro, "dist/components/taro-image-core.js"), "utf8");
const cssLiteral = component.match(/const indexCss = ("(?:[^"\\]|\\.)*");/)?.[1];
assert.ok(cssLiteral, "Taro image styles must be available for the layout regression");
const styles = JSON.parse(cssLiteral) + "\n" + await readFile(new URL("../src/app.css", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const [width, height] of [[1280, 1328], [1104, 1520], [1472, 1152]]) {
    // Same DOM emitted by Taro's widthFix image. Include the generated footer.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#dceadb"/><text x="10" y="${height - 10}" font-size="32">AI 生成</text></svg>`;
    await page.setContent(`<style>${styles}</style><div style="width:350px"><taro-image-core class="artifact-image taro-img__widthfix"><img class="taro-img__mode-widthfix" src="data:image/svg+xml,${encodeURIComponent(svg)}"></taro-image-core></div>`);
    await page.locator("img").evaluate((img) => img.decode());
    const bounds = await page.locator("img").evaluate((img) => ({ image: img.getBoundingClientRect().height, container: img.parentElement.getBoundingClientRect().height }));
    assert.ok(Math.abs(bounds.image - bounds.container) <= 1, `完整图片及 AI 标识不能被默认高度裁掉：${JSON.stringify(bounds)}`);
  }
  console.log("PASS mobile full-image layout: square, portrait and landscape retain their entire image/footer");
} finally { await browser.close(); }
