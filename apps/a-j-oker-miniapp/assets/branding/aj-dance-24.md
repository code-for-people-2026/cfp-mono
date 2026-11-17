# 阿 J 24 帧舞蹈加载动画

## 来源与保留文件

- 内置 `image_gen` 原始输出：`/Users/sunmer/.codex/generated_images/01a1e501-a034-7c12-8376-d1efa46b29bf/exec-a389cb0b-0565-4316-a76a-e957fa5db483.png`
- 项目内原图副本：`assets/branding/aj-dance-24-source.png`
- 原图是 1536 × 1024 RGBA PNG，共 2,081,807 字节；严格按 6 列 × 4 行切成 24 个 256 × 256 方格，帧序为从左到右、从上到下。
- 项目内副本与生成原图逐字节一致；原图不导入应用包，也没有被重绘、插帧或覆盖。
- 生成提示词保存在 `/tmp/aj-loader24-20261117/imagegen-prompt.txt`，完整内容见本文末尾。使用内置 `image_gen`，未使用 CLI/API 付费回退。

## 归一化与打包

- 每帧先在原图上寻找脸部：限定上半区 `y=55..125`，筛选 `alpha>128` 且符合肤色阈值的像素，再取最大的四连通分量。24 帧脸部连通分量均合理，面积为 2,183–2,448 像素，水平质心为 `x=125.673..169.983`。
- 用脸部水平质心作为横向锚点，用 `alpha>128` 可见像素的最大 y 作为落地脚基线。每帧只做平移；所有帧统一按 `99/256 = 0.38671875` 缩放，没有逐帧缩放、CSS 旋转、混合残影或姿势重绘。
- 归一化目标为 104 × 104 物理像素方格：脸部锚点对齐 `x=52`，脚基线对齐 `y=96`。24 格横向打包为一个 2496 × 104 的透明序列图。
- 应用内资源：`src/assets/aj-dance-24.png`，24,589 字节，RGBA 调色板 PNG；Sharp 参数为最多 128 色、`dither: 0.2`、压缩级别 9、effort 10。实际图像带透明通道，低于 130,000 字节预算。

## 播放方式

- 视窗保持 38 × 52 逻辑像素，序列图显示为 1248 × 52，`left: -7px`、`top: 0`，因此每个 52 × 52 逻辑格居中裁入视窗。
- 仅对序列图做 `translateX(0)` 到 `translateX(-100%)`，时长 1.6 秒，`steps(24, end)` 无限循环，即每秒显示 15 个真实绘制的不同帧。
- 已按用户修正移除静态图片的 CSS 摆动、旋转与整体位移。圆点仍按原有 1.8 秒 1→2→3 透明度循环；降低动态效果时停在第一帧并显示三个静态圆点。
- 预览：`assets/branding/aj-dance-24-preview.gif`。它使用同一组归一化后的 24 帧，156 × 156、循环播放，每帧 GIF 延时 70 ms（约 14.3 fps），仅增加应用的浅色中性背景以兼容 GIF；没有添加额外移动。本机指定的 `/usr/local/bin/ffmpeg` 是无法执行的 x86_64 文件（`Bad CPU type in executable`），因此没有安装替代依赖，改由仓库现有 Sharp/cgif 编码 GIF。
- 本文件只记录处理和接入事实；最终视觉与应用验收由独立 GPT supervisor 完成。

## 独立检查记录（2026-11-17）

- 已对照改动前副本审阅：组件只更换素材导入；样式只替换小丑动画及其降低动态效果选择器。38 × 52 视窗、圆点 1→2→3 轮播和阶段文案组件保留。
- 24 格内容各不相同；归一化后可见横向范围为每格 x=22..80，处于视窗对应的 x=14..90 内，手脚未被视窗裁掉；脚底 y=95..96。
- 21 项相关测试、TypeScript 类型检查、组件 ESLint、微信原生构建及 5 个 WXSS 文件检查通过；`git diff --check` 通过。
- 本次构建包体 1,727,767 字节（约 1687.3 KiB），低于 1800 KiB 预算，只打包新版舞蹈素材。
- 微信开发工具确认使用隔离的合成测试身份；同一窗口被另一项交接流程测试同时操作，本轮未完成可靠的模拟器动画采样，因此不记为模拟器动态验收或真机验收。预览 GIF 已生成，供动作连续性审看。
- GLM 两个订阅账号在执行前均报额度耗尽，检查确认无部分代码改动后，按用户 AGENTS.md 授权明确使用 `gpt-5.6-sol` 和现有 ChatGPT 登录完成有限接入任务；未启用 API 密钥计费。

## 完整生成提示词

```text
Use case: stylized-concept / animation in-betweening. Asset type: a production transparent PNG sprite sheet with TWENTY-FOUR consecutive hand-drawn animation poses of the supplied 阿 J mascot. Input 1 is the previous SIX-frame dance reference: preserve this exact character, but the poses were too far apart. Input 2 is his identity/style portrait. Primary request: REDRAW a truly fluid full-body dance with many carefully drawn intermediate arm/leg poses, NOT 24 unrelated poses, NOT duplicates of six frames, NOT merely rotating or translating a static figure. Output ONE sheet, EXACTLY SIX columns by FOUR rows, 24 equal SQUARE cells, landscape 3:2 aspect ratio, reading order left-to-right then top-to-bottom. All cells exactly the same dimensions; center of the body always at the exact center of each cell, same head size and overall scale, identical baseline, identical orthographic front camera. Every figure fully inside its cell with 15% transparent padding on all sides, figure height about 78% of a cell and maximum width about 65%, including outstretched hands. This precise registration is crucial. Character: same friendly chibi young man with dark wavy hair and J-like forelock, sage-green and ivory two-point jester cap with round bells, sage jacket with tiny coral heart, ivory shirt, tan trousers, green shoes. No red clown nose, no face paint. Maintain the original warm soft 3D clay appearance; simplify fine textures for tiny mobile display. Choreography is one continuous subtle but recognizable two-sided dance over all24 cells. Frames1-6 gradually shift weight toward viewer-left, smoothly raise the viewer-left forearm from waist toward shoulder while bending the opposite knee and lifting the opposite heel. Each frame is a small anatomical step between the prior and next, never a sudden pose jump. Frames7-12 smoothly lower the forearm, place the foot down and return to center. Frames13-18 mirror that progression toward viewer-right, smoothly raise the other arm and lift the other heel. Frames19-24 smoothly return to center, with frame24 almost the same as frame1 so loop seam is invisible. Knees flex naturally, the hands and feet REALLY articulate; torso and hat react slightly. Keep the face looking forward with the same gentle smile throughout. Head tilt no more than5degrees; no big leaps, no spins, no changing size. It should look like consecutive frames sampled at15fps from one smooth dance, NOT a contact sheet of alternate character designs. No floor shadows or decorative motion marks. Genuine fully transparent alpha background between and around figures. No colored halo, no background grid, no dividers, no numbers, labels, text, logos or watermark. Exactly24 fully visible characters, tightly controlled uniform 6x4 layout. Preserve identity, outfit, palette and proportions rigorously across ALL frames.
```
