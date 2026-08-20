# 码成仝公共科技设计系统 v0.1

状态：视觉与组件规范提案。用于评审，不代表官网、Payload 或 ideal 原型站已经改造。

## 1. 设计原则

1. **公共行动清楚可见**：公益红用于母品牌、主行动、亲历输入和待确认责任，不把红色默认解释为错误。
2. **技术能力不越过真人责任**：AI 整理后的信息使用银灰；只有经过真人确认，结果才能使用青绿。
3. **同一公共外壳，不强行统一内容画布**：母品牌、导航、状态、动作和返回规则固定；长文、矩阵和原型舞台允许保留不同密度。
4. **原型边界持续可见**：ideal 的每个公开页面持续显示「交互原型 / 不接真实业务数据 / 返回正式介绍」。
5. **手机内的 App 不变**：本系统只重构 GitHub Pages 的承载页，不改变手机视图里的产品内容和交互。

## 2. 色彩 token

| 语义 | CSS token | 值 | 用途 |
|---|---|---:|---|
| 公共底色 | `--background` | `#F4F7FA` | 官网与公共壳层底色 |
| 主文字 | `--foreground` | `#081628` | 标题、正文、深色原型舞台 |
| 表面 | `--surface` | `#FFFFFF` | 卡片、导航、浮层 |
| 公益红 | `--primary` | `#D20D18` | 品牌、主行动、亲历输入 |
| 公益红 hover | `--primary-hover` | `#B80B14` | 主按钮 hover |
| 公益红 active | `--primary-active` | `#980A12` | 主按钮 active |
| 公益红浅底 | `--primary-soft` | `#FFF0F1` | 高亮问题、标签、提示区 |
| 次级底色 | `--muted` | `#EEF2F6` | 次级面板、分段控件 |
| 次级文字 | `--muted-foreground` | `#5C6877` | 说明、元信息 |
| 结构描边 | `--border` | `#D7DFE8` | 卡片、输入、分隔 |
| 强结构描边 | `--border-strong` | `#BBC7D3` | 输入、浮层、未确认轨道 |
| 真人确认 | `--confirm` | `#2AA79D` | 只用于真人确认后的结果 |
| 原型舞台 | `--prototype-stage` | `#071321` | 手机 App 周围的深色承载区 |
| 焦点环 | `--ring` | `rgba(210,13,24,.32)` | 键盘焦点 |

约束：青绿不能用于 AI 处理中、成功预测、装饰性光效或一般链接；它只表达「真人已经确认」。

## 3. 字体与字号

字体栈：`PingFang SC`, `Noto Sans SC`, `Microsoft YaHei`, `system-ui`, `sans-serif`。规格、编号、数据使用 `IBM Plex Mono`, `ui-monospace`。

| 级别 | 字号 / 行高 | 字重 | 字距 | 用途 |
|---|---:|---:|---:|---|
| Display | 64 / 68 px | 800 | -4.5% | 产品首屏标题；移动端 48 / 52 px |
| H1 | 48 / 56 px | 700 | -3.5% | 页面标题；移动端 36 / 44 px |
| H2 | 36 / 44 px | 700 | -2.5% | 大分区；移动端 28 / 36 px |
| H3 | 24 / 32 px | 700 | -1.5% | 卡片与小节标题 |
| Body L | 18 / 30 px | 400 | 0 | 首屏说明 |
| Body | 16 / 28 px | 400 | 0 | 正文 |
| UI | 14 / 22 px | 600 | 0 | 导航、按钮、输入 |
| Label | 13 / 20 px | 600 | 0 | 标签与状态 |
| Meta | 12 / 18 px | 500 | 1% | 元信息、版本、编号 |

长文正文最大宽度 720 px；正文段落之间 24 px；一级章节之间 64–80 px。

## 4. 间距与栅格

- 基础单位：4 px。
- 核心阶梯：4、8、12、16、20、24、32、40、48、64、80、96、128 px。
- 组件内距：12 / 16 / 20 / 24 px。
- 卡片间距：16 / 20 / 24 px。
- 页面分区：80 / 96 / 128 px。

| 断点 | 栅格 | 列间距 | 页面边距 | 最大内容宽度 |
|---|---:|---:|---:|---:|
| `>=1280` | 12 列 | 24 px | 32 px，1440 画布建议 80 px | 1280 px |
| `768–1279` | 8 列 | 20 px | 24 px | 100% |
| `320–767` | 4 列 | 16 px | 16 px | 100% |

外壳高度：完整 Header 80 px；紧凑 Header 64 px；移动 Header 56 px；原型状态条 40–48 px。移动关键控件最小触控面积 44 × 44 px。

## 5. 形状、描边与阴影

- 控件圆角：8–9 px。
- 标签：999 px 胶囊圆角。
- 卡片与菜单：12–14 px。
- 主容器与原型舞台：20 px。
- 标准描边：1 px；矩阵密集分隔可使用 0.5–1 px。
- `E1`: `0 2px 8px rgba(8,22,40,.05)`，小控件与静态卡片。
- `E2`: `0 12px 36px rgba(8,22,40,.08)`，浮层与主要卡片。
- `E3`: `0 24px 64px rgba(8,22,40,.12)`，首屏视觉和原型舞台。
- 红色主按钮可附加 `0 8px 20px rgba(210,13,24,.18)`。

玻璃效果只允许用于产品首屏信息图和 ideal 原型承载舞台；长文正文、表单和矩阵数据区使用实色表面。

## 6. Shadcn/ui 组件规格

采用 shadcn 的语义接口、Radix 行为与 CVA variants；视觉由本系统 token 覆盖。

### Button

- `sm`: 36 px 高，左右 12 px。
- `default`: 44 px 高，左右 20 px。
- `lg`: 48 px 高，左右 24 px。
- `default`: 公益红；每个视区原则上只出现一个主行动。
- `secondary`: 白色表面 + 强结构描边。
- `outline`: 透明表面 + 标准描边。
- `ghost`: 无描边，用于会话重置或低优先级动作。
- focus ring 2 px，offset 2 px；disabled opacity 45%。

### Badge

- 最小高度 24 px，水平内距 10 px。
- `prototype`: 红色状态点 + 白底红字。
- `neutral`: AI 整理、待确认、版本等中性状态。
- `confirmed`: 青绿，只能用于真人已经确认。

### Header

- Full：品牌字标、副标、四项主导航；首页、宣言、协议使用。
- Compact：品牌、当前对象、四项主导航、一个上下文动作；正式产品页、矩阵和 ideal 使用。
- 移动端两种 Header 折叠成同一个导航面板；当前对象不能隐藏。

### Input / Composer

- 默认 44 px 高；对话输入框可为 52–56 px。
- 1 px 强结构描边；focus 使用 3 px 浅红外环。
- 推荐问题使用 Badge/Button 语义；第一个问题可以使用 `primary-soft` 高亮。

### Card

- 默认 20–28 px 内距。
- 官网叙事卡：舒展密度。
- 矩阵工具卡：紧凑密度，但维持相同 token 与 focus 规则。
- 原型承载卡：允许深色舞台；Header 和状态条仍使用公共 token。

## 7. Banner 信息流语法

选定方案：**双线进入真人确认**。

- 邻里 → AI：保留红色多源线束，表达亲历的丰富性。
- AI → 真人：恰好两条、1.5–2 px、不交叉、单一缓弯。
  - 银灰线：AI 整理后的事实依据。
  - 暖红线：等待真人确认的承诺或责任。
- 真人检查点：40 px 外圈，16 px 核心；必须是颜色状态变化的唯一关口。
- 真人之后：一条 1.5–2 px 青绿短线和终点；不得在真人之前出现青绿。
- Banner 中的信息流不持续漂浮；若使用动效，200–400 ms 的一次性收束即可，并遵守 `prefers-reduced-motion`。
- 当前生成图只作为构图和色彩参考。正式实现时插画资产只保留三节点与信息流；图中的导航、标题和说明必须由 HTML 组件渲染，不得被栅格化进图片。

## 8. 页面应用

### 官网主站

- 新增近邻互助组正式介绍页。
- 首页、宣言、协议使用 Full Header。
- 正式产品页与矩阵使用 Compact Header。
- 首页保留问答首屏；点击「近邻互助组是什么？」后进入对话，回答中再出现原型体验 CTA。

### ideal GitHub Pages

- 重构页面外壳：Compact Header、原型状态条、返回正式介绍、反馈入口和背景舞台。
- 客户体验原型为主入口；实施对照为次级工程材料。
- 街坊味与楼道收一收标为场景探索，不与旗舰产品并列。
- 手机 App 视图及其中交互保持不变。

## 9. Tailwind v4 / shadcn token 契约

```css
:root {
  --background: #f4f7fa;
  --foreground: #081628;
  --surface: #ffffff;
  --primary: #d20d18;
  --primary-foreground: #ffffff;
  --primary-soft: #fff0f1;
  --muted: #eef2f6;
  --muted-foreground: #5c6877;
  --border: #d7dfe8;
  --ring: rgba(210, 13, 24, 0.32);
  --confirm: #2aa79d;
  --confirm-soft: #e8f8f5;
  --radius: 12px;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-confirm: var(--confirm);
}
```

组件只能消费语义 token；页面 JSX 不直接写具体红、银、青绿色值。若后续增加暗色模式，必须以单独主题评审，不能自动把原型舞台的深色扩展到全部公共页面。

## 10. 本轮边界

- 包含：颜色、字体、尺寸、栅格、圆角、描边、阴影、动效、Header、按钮、状态、输入、卡片、Banner 语法、主站/ideal 应用规则。
- 不包含：正式 logo 重绘、页面实现、Payload 模型、原型内 App UI 改造、严格 WCAG 认证。
