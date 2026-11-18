# 阿 J 24 帧舞蹈加载动画（左右脚交替修正版）

## 修正背景与产物

用户反馈旧版 24 帧舞蹈前后两半都抬起同一只脚。2026-11-18 使用内置 `image_gen` 生成修正素材：前两行继续抬“画面左侧”的左脚，后两行改为抬“画面右侧”的右脚。本页记录的打包过程只做透明底切割、统一缩放与平移配准，没有用代码重绘、镜像整角色、复制姿势或追加假变换。

| 用途 | 路径 | 尺寸 | 字节数 | SHA-256 |
|---|---|---:|---:|---|
| 运行时序列图（覆盖原资源） | `src/assets/aj-dance-24.png` | 2496 × 104 | 25,173 | `bfd79c18ca9253e11cb12b8416c3a8375aad3ed7430be815c254d6f7133d25fd` |
| 修正版生成图逐字节副本 | `assets/branding/aj-dance-24-alternating-source.png` | 1536 × 1024 | 2,086,803 | `b9a6bfe2a7b87e41b5f1a6a78891c884a1d6bfdbfc3009ce8261a41c38240ac3` |
| 品牌预览 GIF | `assets/branding/aj-dance-24-alternating-preview.gif` | 156 × 156 × 24 帧 | 198,171 | `8c19a050195b017eec51f5b9297e276e3ef669fe5d0b73a58ae8dc21968d8588` |
| 临时视觉审阅拼图 | `/tmp/aj-alternating-20261118/normalized-contact-sheet.png` | 624 × 416（6 × 4） | 36,622 | `b4c832d7309d678bc4d74d85f0ed5930599d539e900158b3fe74dc1b1e38adfc` |

生成原始输出位于 `/Users/sunmer/.codex/generated_images/01a1e501-a034-7c12-8376-d1efa46b29bf/exec-9918efcc-62ae-47ca-bf20-564f667c1c62.png`，项目内副本与其逐字节一致。旧版 `aj-dance-24-source.png`、`aj-dance-24-preview.gif` 和 `aj-dance-24.md` 保留作历史记录，本修正未覆盖它们。

## 24 帧顺序与动作意图

生成图严格按 6 列 × 4 行、从左到右、再从上到下读取：

1. 第 1–12 帧（第 1–2 行）：画面左侧的左脚抬起再落下，画面右侧的右脚保持落地承重。
2. 第 13–24 帧（第 3–4 行）：重心经过双脚后，画面右侧的右脚抬起再落下，画面左侧的左脚保持落地承重；第 24 帧回到居中站姿以衔接循环。

独立视觉验收时应重点对比第 6/7 帧与第 18/19 帧，并检查着地脚位置是否稳定。本文件不把该动作效果记为已通过人工验收；请以临时 6 × 4 拼图和 GIF 为准独立审看。

## 归一化与打包

- 原图每格 256 × 256；先以 Lanczos3 统一缩到 99 × 99，比例为 `99/256 = 0.38671875`。
- 脸部锚点沿用上一版检测方式：在上半区寻找 `alpha>128` 的肤色最大连通分量，取水平质心；本次 24 帧脸部面积为 2,212–2,476 像素，水平质心范围为 `x=125.955..170.178`。
- 横向把脸部质心对齐到 104 × 104 输出格的 `x=52`；纵向把 `alpha>128` 可见像素的最大 y（着地脚基线）对齐到 `y=96`。
- 每帧只允许统一缩放后的平移配准，没有逐帧缩放、旋转、镜像、透明度动画、姿势复制或代码重绘。
- 24 格横向拼为 2496 × 104 透明 PNG，使用 Sharp 调色板压缩：最多 128 色、`dither: 0.2`、压缩级别 9、effort 10。
- 最终 24 个解码帧 SHA-256 全部不同；可见横向范围为每格 `x=21..80`，均落在 CSS 38 × 52 视窗对应的 `x=14..90` 安全区内；着地基线解码后为 `y=95..96`，符合目标 `y=96` 的一像素重采样容差。

## 播放保持不变

本次没有修改 `app.css`、组件、聊天页或包配置。现有播放仍为：

- 38 × 52 逻辑像素视窗，序列图显示宽度 1248 × 52，`left: -7px`；
- `translateX(0)` 到 `translateX(-100%)`，1.6 秒、`steps(24, end)`、无限循环；
- 运行时每帧理论延时为 `1600ms / 24 = 66.6667ms`，约 15 fps。

也就是说，只替换 `src/assets/aj-dance-24.png` 的绘制内容，播放节奏、循环方式和界面结构不变。

## 预览与临时审阅文件

- `aj-dance-24-alternating-preview.gif` 的每一帧都从最终调色板压缩后的运行时序列图重新解码得到，而不是使用压缩前的中间帧。
- GIF 为 156 × 156、24 帧、`loop=0`、每帧 70 ms，底色 `#f6f8f7`。70 ms 约 14.286 fps，比运行时的 66.6667 ms 慢 3.3333 ms，仅用于品牌审看，不影响小程序播放。
- `/tmp/aj-alternating-20261118/normalized-contact-sheet.png` 使用同一批最终运行时帧排成 6 × 4，无网格、无额外变换，供独立视觉审看。
- 本机指定的 `/usr/local/bin/ffmpeg` 仍是错误 CPU 的不可执行文件；本次未安装依赖，也未使用它，GIF 由仓库现有 Sharp/cgif 生成。

## 自动验证记录

已执行专用打包校验，结果保存在：

- `/tmp/aj-alternating-20261118/pack-aj-dance-24-alternating.mjs`
- `/tmp/aj-alternating-20261118/verify-aj-dance-24-alternating.mjs`
- `/tmp/aj-alternating-20261118/packing-stats.json`
- `/tmp/aj-alternating-20261118/verification-stats.json`

验证通过项：

- 生成源与项目副本尺寸均为 1536 × 1024 RGBA，字节与 SHA-256 完全一致；源 24 格也全部不同。
- 运行时 PNG 为 2496 × 104、带透明、调色板格式，25,173 字节，低于 130,000 字节预算。
- 24 个 104 × 104 输出帧全部不同，均有可见像素；逐帧不透明 bounds 与安全区记录在 JSON。
- GIF 元数据为 156 × 156、24 页、永久循环、24 个延时全部 70 ms，四角颜色等于 `#f6f8f7`。
- 临时 6 × 4 拼图解码后的 24 格与运行时序列图对应格逐像素一致。
- `git diff --check` 通过。

按边界要求，本任务未运行 Taro 构建、原生构建、模拟器或手机 QA；这些由独立 supervisor 复核。动作交替性与着地脚稳定性仍需 GPT 独立查看临时拼图 / GIF 后确认，本文不预先声称视觉验收通过。

## 独立复核（2026-11-18）

- 已查看生成源图与最终素材解码后的 24 格拼图：第 7 帧抬画面左侧脚，第 18/19 帧抬画面右侧脚；前后两半已使用不同的脚。本文左右方向均以观看画面为准，不指角色自身的解剖左右。
- 对最终 PNG 做独立脚底采样：第 7 帧左右脚底 y 分别为 89/95，第 18 帧分别为 95/84，第 19 帧为 96/86；第 1、13、24 帧两脚底分别同在 96、96、95，确认落脚后再换腿。
- 本地微信原生构建通过；构建包中的序列图与源资源逐字节一致，包体 1,731,717 字节，低于 1800 KiB 预算。
- Git 差异确认组件、样式和聊天页未改动，原有小尺寸及 1→2→3 圆点轮播保留。未在本轮执行模拟器发送或真机验收。

## 完整生成提示词

提示词原文来自 `/tmp/aj-alternating-20261118/imagegen-prompt.txt`：

```text
Use case: precise-object-edit.
Asset type: a transparent animation sprite sheet, exactly 6 columns by 4 rows (24 equal square cells), 1536x1024.
Input image 1 is the EDIT TARGET, the current 24-frame dance of 阿 J. Critical correction: the existing animation incorrectly lifts the viewer-LEFT foot in BOTH halves. Change the second half to lift the viewer-RIGHT foot instead, so the complete loop alternates legs.
Preserve the exact character identity, face, cap, hair, jacket and coral heart on its original side, materials, colors, camera, cell positions, size, and arm gestures. Do NOT mirror entire characters. Keep rows 1 and 2 (frames 1-12) as unchanged as possible.
EDIT ONLY THE LEGS AND NECESSARY HIP/WEIGHT SHIFT in rows 3 and 4 (frames 13-24):
Row 3, columns 1 through 6: both feet on floor; then viewer-RIGHT heel releases; then viewer-RIGHT knee and shoe rise a little; then higher; then higher; then peak. The shoe on the RIGHT SIDE OF EACH CELL must visibly leave the floor, moving toward screen-right. The shoe on the LEFT SIDE OF EACH CELL remains planted on the common ground baseline, bearing the weight throughout this half.
Row 4, columns 1 through 6: viewer-RIGHT leg still lifted near peak; then begins lowering; then halfway down; then right toe lands; then both feet flat with weight centered; then same centered stance as frame1. Smooth small drawn anatomical changes between every consecutive frame, with natural bent knees and clearly separated feet. Peak lift around 15% of the figure height, clearly visible at tiny UI scale. Never lift the viewer-left foot in rows3-4.
Rows1-2 continue the existing viewer-LEFT-foot lift-and-lower, with viewer-right foot planted. Overall sequence: left foot up -> left foot down -> weight transfer through both feet -> right foot up -> right foot down -> centered loop. Do not turn the body away, cross the legs, swap shoes, add limbs, duplicate unchanged poses, add CSS-like rigid tilt, or change costume details.
Keep all 24 figures fully inside their equal cells and maintain a stable head center and planted-foot baseline within every cell. Transparent alpha background, no painted backdrop, checkerboard, floor, shadows, numbers, labels, grid, borders, text, or watermark. Preserve the source transparency. Output the complete 6x4 sheet.
```
