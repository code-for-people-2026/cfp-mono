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
  for (const [width, height] of [[1280, 1280], [1104, 1472], [1472, 1104]]) {
    // Same DOM emitted by Taro. The sole visible label sits inside the image.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#dceadb"/><text x="${width - 24}" y="${height - 24}" text-anchor="end" font-size="28">阿J先生生成</text></svg>`;
    await page.setContent(`<style>${styles}</style><div style="width:350px"><taro-image-core class="artifact-image taro-img__widthfix"><img class="taro-img__mode-widthfix" src="data:image/svg+xml,${encodeURIComponent(svg)}"></taro-image-core></div>`);
    await page.locator("img").evaluate((img) => img.decode());
    const bounds = await page.locator("img").evaluate((img) => ({ image: img.getBoundingClientRect().height, container: img.parentElement.getBoundingClientRect().height }));
    assert.ok(Math.abs(bounds.image - bounds.container) <= 1, `完整图片及水印不能被默认高度裁掉：${JSON.stringify(bounds)}`);
    for (const stacked of [false, true]) {
      await page.setContent(`<style>${styles}</style><div class="${stacked ? "artifact-thumbnail-stack" : ""}"><div class="artifact-thumbnail"><div class="artifact-image-frame"><taro-image-core class="artifact-thumbnail-image"><img class="taro-img__mode-aspectfit" src="data:image/svg+xml,${encodeURIComponent(svg)}"></taro-image-core></div></div></div>`);
      await page.locator("img").evaluate((img) => img.decode());
      const visible = await page.locator("img").evaluate((img) => {
        const image = img.getBoundingClientRect(), frame = img.parentElement.getBoundingClientRect();
        return image.left >= frame.left - 0.1 && image.top >= frame.top - 0.1 && image.right <= frame.right + 0.1 && image.bottom <= frame.bottom + 0.1;
      });
      assert.ok(visible, `缩略图必须完整保留 ${width}×${height} 图片及右下角水印（stacked=${stacked}）`);
    }
  }
  console.log("PASS mobile thumbnails and full images retain square, portrait and landscape images with the in-image watermark");
} finally { await browser.close(); }
