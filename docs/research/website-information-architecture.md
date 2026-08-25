# 官网组织、旗舰产品与互动工具的一手设计原则

研究日期：2026-08-17
对应问题：组织官网、旗舰产品、公开宣言和互动工具应遵循哪些信息架构、导航一致性、内容层级和信任表达原则？

## 结论摘要

码成仝不需要把所有页面做成同一种版式，但需要让所有页面服从同一个“公共体验契约”：访客始终知道自己在哪里、这是谁提供的、如何回到上一级、当前内容是否成熟，以及下一步能做什么。

这支持一种双层结构：官网首页、宣言和协议使用完整的组织级外壳；近邻互助组、牛马能力剥夺矩阵和原型使用更紧凑的产品/工具级外壳。两个外壳可以有不同密度，但组织标识、产品归属、关键路径、移动端行为和状态表达必须一致。GOV.UK 的官方模式明确把通用身份放在上层、服务名和服务级工具放在下层，并要求服务名链接回服务首页；这正是“母品牌 + 旗舰产品”关系可借鉴的结构，而不是要求复制其视觉样式。[GOV.UK：Navigate a service](https://design-system.service.gov.uk/patterns/navigate-a-service/)

对于当前官网，研究支持以下落地方向：

- 保留首页的问答式首屏；把「近邻互助组是什么？」作为第一个高亮推荐问题。它先在首页完成一次简短解释，再给出「了解近邻互助组」或「体验原型」的明确动作。
- `codeforpeople.cn` 承担可信、稳定、可被引用的组织与产品说明；`ideal.codeforpeople.cn` 承担频繁迭代的原型。跨域后仍持续显示「码成仝 / 近邻互助组 / 原型」三层身份和返回正式介绍页的路径。
- 主导航只表达最重要的访客意图，不承担站点地图职责；正式名称在页面标题、正文和页脚中保留。
- 原型状态不是一次性免责声明：应在原型区每页持续可见，并同时说明“这是试验什么、目前不能做什么、是否保存数据、如何反馈”。
- 牛马能力剥夺矩阵首先是结构化内容，只有在单元格本身需要方向键导航、选择或编辑时才应实现为 ARIA `grid`；否则优先使用原生 HTML 表格，并提供移动端或简化视图。

## 证据等级

本文把来源分为三类，避免把案例偏好误写成硬要求：

1. **基线约束**：W3C WCAG 2.2 的规范性成功标准。若项目以 WCAG 2.2 AA 为可访问性目标，这些是验收条件。
2. **强建议**：GOV.UK、USWDS、W3C WAI/APG 等官方设计系统和实践指南。它们不是码成仝的法律或品牌规范，但有明确的公共服务经验与可访问性依据。
3. **案例灵感**：Mozilla/Firefox、Tor Project/Tor Browser、Code for America/GetCalFresh 的原始网站。它们说明一种结构在真实网站上如何落地，不证明这是唯一正确答案。

## 一、基线约束：不因页面类型变化而丢失可预测性

### 1. 重复导航保持相同相对顺序

WCAG 2.2 的 3.2.3（AA）要求，同一组页面中重复出现的导航机制每次应保持相同相对顺序，除非变化由用户发起。这并不要求每页拥有同样多的链接，却要求同名、同用途的组织标识、主导航和帮助入口不要在不同页面随意换位。[WCAG 2.2：3.2.3 Consistent Navigation](https://www.w3.org/TR/WCAG22/#consistent-navigation)

因此，完整 header 和紧凑 header 可以并存，但应有同一导航契约：

- 码成仝标识始终指向官网首页；
- 近邻互助组名称始终指向正式产品介绍页；
- 相同功能使用相同名称、图标含义和相对顺序；
- 移动端折叠不能改变信息层级或隐藏唯一的返回路径。

WCAG 3.2.4（AA）还要求，同一组页面中具有相同功能的组件应被一致识别。因此，不应在一个页面把同一路径叫「近邻互助组」，另一个页面只叫「开始」，又在原型中只显示无文字图标。[WCAG 2.2：3.2.4 Consistent Identification](https://www.w3.org/TR/WCAG22/#consistent-identification)

### 2. 页面结构和标签必须可被程序理解

视觉层级不能只靠字号、颜色或位置表达。WCAG 1.3.1（A）要求信息、结构和关系能够被程序确定；2.4.6（AA）要求标题和标签描述其主题或目的。[WCAG 2.2：1.3.1 Info and Relationships](https://www.w3.org/TR/WCAG22/#info-and-relationships)；[WCAG 2.2：2.4.6 Headings and Labels](https://www.w3.org/TR/WCAG22/#headings-and-labels)

落到本项目，至少包括：

- 每页只有一个明确的主标题，后续标题按层级组织；
- 主导航、面包屑、页内目录和产品状态分别拥有可辨识的语义区域；
- 「为什么做 / 如何选题 / 如何约束」可以作为导航标签，但对应页面的主标题仍使用《数据平权宣言》《牛马能力剥夺矩阵》《牛马互助协议》等正式名称；
- 图标按钮必须有可访问名称，不能把纸飞机、返回箭头或信息图标作为唯一说明。

### 3. 键盘、焦点、触控目标和响应式布局必须在验收范围内

所有功能应能通过键盘操作（WCAG 2.1.1 A）；键盘焦点必须可见（2.4.7 AA）且不能被吸顶 header、悬浮提示或固定底栏完全遮挡（2.4.11 AA）。指针目标原则上至少为 24 × 24 CSS 像素，或满足规范中的间距/等价操作等例外（2.5.8 AA）。[WCAG 2.2：2.1.1 Keyboard](https://www.w3.org/TR/WCAG22/#keyboard)；[2.4.7 Focus Visible](https://www.w3.org/TR/WCAG22/#focus-visible)；[2.4.11 Focus Not Obscured](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum)；[2.5.8 Target Size](https://www.w3.org/TR/WCAG22/#target-size-minimum)

如果矩阵支持拖动、平移或重新排列，WCAG 2.5.7（AA）要求同时提供不依赖拖动的单指针操作。页面在 320 CSS 像素宽的等效视口下也不应因二维滚动而失去内容或功能，规范允许真正需要二维布局的表格作为例外，但这不等于可以忽略可用的窄屏替代方案。[WCAG 2.2：2.5.7 Dragging Movements](https://www.w3.org/TR/WCAG22/#dragging-movements)；[WCAG 2.2：1.4.10 Reflow](https://www.w3.org/TR/WCAG22/#reflow)

### 4. 重要页面不应只有一条发现路径

WCAG 2.4.5（AA）要求在一组页面中提供多于一种定位页面的方式，流程步骤除外；2.4.4（A）要求链接目的能从链接文本或其上下文中确定。[WCAG 2.2：2.4.5 Multiple Ways](https://www.w3.org/TR/WCAG22/#multiple-ways)；[WCAG 2.2：2.4.4 Link Purpose](https://www.w3.org/TR/WCAG22/#link-purpose-in-context)

因此，近邻互助组不应只藏在首页高亮 tip 中：它还应出现在主导航、相关回答的动作按钮和页脚。宣言、协议和矩阵也不应只靠浏览器“返回”才能离开。链接文本应说明动作，例如「了解近邻互助组」「体验近邻互助组原型」「返回正式产品介绍」，而不是反复使用孤立的「点击这里」。

## 二、强建议：用统一关系，而不是统一版式

### 1. 组织级外壳与产品级外壳分层

GOV.UK 的官方导航模式把最通用的 GOV.UK 身份和全站工具放在上层，把服务名、服务导航和服务级工具放在更具体的下层；页面级元素再放在服务导航之后。其目的包括帮助用户理解母体与服务的关系、确认自己在正确的位置，并让整个体系感觉像一个网站。[GOV.UK：Navigate a service](https://design-system.service.gov.uk/patterns/navigate-a-service/)

可转译为码成仝的规则：

| 层级 | 完整内容页 | 紧凑体验页 |
| --- | --- | --- |
| 组织身份 | 码成仝标识 + 主导航 | 码成仝标识或文字归属，链接回官网 |
| 当前对象 | 页面正式标题 | 「近邻互助组」或「牛马能力剥夺矩阵」名称，链接回其稳定入口 |
| 当前状态 | 通常不需要 | 「原型 / 试验中」持续可见 |
| 主要动作 | 阅读、了解、前往产品 | 完成当前体验；保留返回正式介绍的路径 |

紧凑版不是“没有官网 header”，而是保留身份、位置和返回路径后，删去会干扰主要任务的探索性导航。GOV.UK 同一模式也强调：导航应只放最重要、对用户最有用的顶层区域，它不是站点地图。[GOV.UK：Navigate a service](https://design-system.service.gov.uk/patterns/navigate-a-service/)

### 2. 导航标签从访客意图出发

USWDS 的 Header 指南建议列出重要站点区域，并使用短、清楚、无陌生术语的链接标签；它把 header 的作用定义为帮助用户识别所在位置并快速到达主要区域。[USWDS：Header](https://designsystem.digital.gov/components/header/)

这支持主导航使用「近邻互助组 / 为什么做 / 如何选题 / 如何约束」，而把正式文档名用于页面标题。前者降低首次访客理解成本，后者保留思想文本的正式身份。实施时应确保：

- 导航标签和落地页标题之间有立即可见的对应说明，例如「为什么做」落地后主标题为《数据平权宣言》，标题上方或摘要中交代二者关系；
- 当前区域通过视觉状态和 `aria-current` 表达；
- 不把「产品」「项目」「行动」「服务」混用为近邻互助组的平级称呼。

### 3. 内容按“先判断是否相关，再逐步深入”排序

USWDS 的设计原则要求从真实用户需要出发，并在早期和迭代过程中用真实用户验证原型，而不是只根据内部组织结构做信息架构。[USWDS：Design principles](https://designsystem.digital.gov/design-principles/)

官方内容指南还建议把最重要的信息放在句子、段落和章节开头，以短章节和描述性标题支持扫描；每块内容都应能对应已排序的用户需要。[ONS Service Manual：Structuring content](https://service-manual.ons.gov.uk/content/writing-for-users/structuring-content)

据此，稳定的近邻互助组产品介绍页应优先回答：

1. 它是什么、为谁解决什么具体问题；
2. 现在处于什么阶段，哪些能力可以体验；
3. 体验会发生什么、不会发生什么；
4. 它为什么由码成仝来做；
5. 如何反馈、参与或继续阅读理念与约束。

宣言和协议可以保持长文，但首屏应先给出简短摘要、更新时间、阅读时长或页内目录；章节标题应表达具体内容，而不只使用「背景」「介绍」等空泛标题。页内目录是长文的辅助导航，不代替全站 header。

### 4. 原型状态是服务级信息，应持续显示并允许反馈

GOV.UK Phase banner 的官方规则是：用 phase banner 告知用户服务仍在开发；状态横幅应出现在服务所有页面，并附带反馈入口，反馈完成后不要让用户丢失原来的位置。[GOV.UK Design System：Phase banner](https://design-system.service.gov.uk/components/phase-banner/)

GOV.UK 对 alpha 的定义更严格：alpha 用于以最低必要复杂度测试高风险假设，不是生产服务，并且不应直接向公众开放。[GOV.UK Service Manual：How the alpha phase works](https://www.gov.uk/service-manual/agile-delivery/how-the-alpha-phase-works)

所以 `ideal.codeforpeople.cn` 若对公众开放，建议称为「原型」或「公开体验原型」，不要直接借用可能让人误解为可办理真实事务的「Alpha 服务」。每页应持续显示：

- **身份**：近邻互助组，由码成仝发起；
- **阶段**：公开体验原型，仍在试验；
- **能力边界**：现在能体验什么，不能完成什么真实互助事务；
- **数据边界**：是否保存输入、是否使用真实个人资料、AI 生成内容如何标识；
- **反馈路径**：简短反馈入口和返回正式产品介绍页的链接。

这不仅是“免责声明”，而是帮助访客形成正确预期的产品内容。状态最好位于紧凑 header 下方或首屏固定位置，并在页面内的关键动作前再次给出与该动作有关的具体限制。

### 5. 密集矩阵先选正确语义模型，再做视觉压缩

W3C WAI 的表格教程要求用表头和数据单元格的结构化标记表达关系；二维表格应为行列标题使用 `<th>` 和适当的 `scope`，复杂表格可使用 `id`/`headers` 建立显式关联，并用 caption 与摘要帮助用户理解整体主题和结构。[W3C WAI：Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/)；[Tables with Two Headers](https://www.w3.org/WAI/tutorials/tables/two-headers/)；[Caption & Summary](https://www.w3.org/WAI/tutorials/tables/caption-summary/)

WAI 还明确建议优先降低表格复杂度：把不同子主题拆成更简单的表格，并确保响应式变形后结构关系仍然存在。[W3C WAI：Tables Tips and Tricks](https://www.w3.org/WAI/tutorials/tables/tips/)

语义选择应遵循以下分界：

- **原生 `table`**：用户主要阅读、比较，单元格内即使有独立链接或按钮，也仍是普通数据表。每个控件自然进入 Tab 顺序。
- **ARIA `grid`**：单元格本身需要被选择、编辑，或需要用方向键在大量交互单元格间导航。APG 指出 grid 是复合组件，通常整个 grid 只有一个 Tab 停靠点，内部焦点移动和单元格交互都必须由作者实现。[W3C APG：Table Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/table/)；[Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)

不要因为视觉上像矩阵就直接使用 ARIA `grid`。对当前牛马能力剥夺矩阵，更安全的默认方案是原生表格 + 结构化详情面板；若将来加入单元格选择或键盘方向导航，再按 APG 完整实现并用浏览器/辅助技术组合测试。

USWDS 的表格组件为密集表格提供了可选灵感：长表可使用粘性表头，窄屏可根据内容选择水平滚动或堆叠模式，排序变化应通过 live region 宣告；但它也明确要求项目自行测试实际实现。[USWDS：Table](https://designsystem.digital.gov/components/table/)

## 三、原始网站案例：可借鉴的落地方式

### Tor Project / Tor Browser：产品是第一动作，组织使命仍然在场

Tor Project 首页直接以 Tor Browser 的价值和下载作为主要内容，同时在同一页面说明 Tor Project 是非营利组织并陈述使命；下载页延续同一站点体系，并在主要下载任务之后再次说明组织身份与使命。[Tor Project 首页](https://www.torproject.org/)；[Tor Browser 下载页](https://www.torproject.org/download/)

可借鉴点：旗舰产品可以成为最醒目的行动入口，而无需把组织官网改写成纯产品落地页。产品体验之后仍应让人理解“谁在做、为什么做”。

### Mozilla / Firefox：产品可拥有专用外壳，但要保留明确归属

Mozilla 官网把产品与组织使命放在同一顶层体系中：产品入口包括 Firefox，组织入口包括 Mozilla Manifesto。Firefox 当前使用独立的产品域名和产品专用导航，但页脚明确标注「Powered by Mozilla」，并链接回 Mozilla 的隐私、条款、社区和品牌信息。[Mozilla 首页](https://www.mozilla.org/)；[Firefox 产品页](https://www.firefox.com/en-US/)

可借鉴点：`ideal.codeforpeople.cn` 可以有更适合原型任务的紧凑外壳，而不必复制完整官网导航；但母品牌归属和可信政策链接必须明确，不能只靠相似配色让用户猜测。

### Code for America / GetCalFresh：在关键动作旁说明服务边界和提供者

GetCalFresh 当前页面在首屏直接说明该网站不能提交申请，并把真实申请动作导向州政府官方站点；同时显示官方合作关系，在页脚明确「GetCalFresh.org is a service delivered by Code for America」。[GetCalFresh 首页](https://www.getcalfresh.org/en/)

Code for America 的组织站则把 GetCalFresh 放在社会安全网工作下，说明其目标、影响和后续去向。[Code for America：Social safety net](https://codeforamerica.org/programs/social-safety-net/)

可借鉴点：正式产品介绍页负责讲清组织逻辑和产品进展；产品/原型页在最靠近用户动作的位置讲清当前能否完成真实事务、由谁提供、下一步去哪里。两边相互链接，但不重复全部内容。

## 四、对码成仝官网的可执行建议

以下是研究证据支持的设计约束，仍需由后续 Wayfinder 票决定具体视觉和文案。

### 建议的信息架构

```text
码成仝（组织与母品牌）
├── 首页：问答式入口；第一个高亮 tip 为「近邻互助组是什么？」
├── 近邻互助组：稳定、可引用的正式产品介绍
│   └── 体验原型：ideal.codeforpeople.cn
├── 为什么做：《数据平权宣言》
├── 如何选题：《牛马能力剥夺矩阵》
└── 如何约束：《牛马互助协议》
```

产品、宣言、矩阵和协议不是四个并列项目：近邻互助组是当前旗舰产品；其余三者分别解释价值依据、选题框架和自我约束。

### 建议的页面契约

| 页面 | 外壳 | 首屏必须回答 | 主要下一步 |
| --- | --- | --- | --- |
| 首页 | 完整 | 码成仝是谁；访客可以问什么 | 触发推荐问题或进入主导航 |
| 近邻互助组正式介绍 | 完整 | 产品是什么、为谁、当前阶段 | 体验原型；了解依据与约束 |
| 宣言/协议 | 完整 | 文档是什么、为何值得读、何时更新 | 页内阅读；前往产品/相关文档 |
| 能力剥夺矩阵 | 紧凑 | 工具用于什么、怎样读 | 探索矩阵；查看产品选题关系 |
| 近邻互助组原型 | 紧凑 + 持续状态 | 这是公开原型、能做与不能做什么 | 完成体验；反馈；返回正式介绍 |

### 建议的首页高亮 tip 行为

点击「近邻互助组是什么？」后应先在原位触发回答，而不是无提示跳出站点。回答建议按四步组织：

1. 一句话解释产品和对象；
2. 一个具体的互助情景，避免只讲抽象愿景；
3. 明示「目前是公开体验原型」；
4. 提供主按钮「体验近邻互助组原型」和次级链接「先了解近邻互助组」。

按钮文案必须说明目的地和动作。进入子域后，紧凑 header 与状态条共同承接上下文，避免用户感觉进入无关网站。

### 建议的矩阵双视图

桌面端可保留完整二维矩阵用于比较，同时提供：

- 行列 caption/摘要和明确表头；
- 键盘可达的筛选、排序或详情按钮；
- 当前行列的视觉强化不能只依赖颜色；
- 单元格详情以点击/键盘触发的面板呈现，不做仅 hover 可见的唯一内容；
- 窄屏提供按一种维度筛选后的列表/卡片视图，或结构清楚的横向滚动表格；
- 若固定 header 或列标题，验证它们不会遮挡键盘焦点。

### 设计验收清单

- [ ] 从任一页面都能识别码成仝、当前页面/产品及其状态。
- [ ] 完整 header 与紧凑 header 中的相同入口保持名称、图标含义和相对顺序。
- [ ] 近邻互助组至少能从主导航、首页推荐问题答案和页脚三处到达。
- [ ] `ideal.codeforpeople.cn` 每页持续显示原型状态、能力边界、数据边界和反馈入口。
- [ ] 宣言、协议和矩阵不再只有「回到首页」这一种导航方式。
- [ ] 页面标题、导航标签、面包屑/当前位置和 `aria-current` 相互一致。
- [ ] 所有功能可用键盘完成，焦点可见且不被固定层遮挡，触控目标符合 WCAG 2.2 AA。
- [ ] 矩阵在实现前明确选择 `table` 或 `grid` 语义，并完成对应的键盘与辅助技术测试。
- [ ] 320 CSS 像素宽等效视口下仍有可理解、可操作的矩阵替代视图。
- [ ] 产品和原型页在关键动作旁说明由谁提供、当前能做什么、不能做什么。

## 参考来源

### 规范与官方可访问性指南

- [W3C Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)
- [W3C WAI Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/)
- [W3C WAI-ARIA Authoring Practices: Table Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/table/)
- [W3C WAI-ARIA Authoring Practices: Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)

### 官方设计系统与服务指南

- [GOV.UK Design System: Navigate a service](https://design-system.service.gov.uk/patterns/navigate-a-service/)
- [GOV.UK Design System: Phase banner](https://design-system.service.gov.uk/components/phase-banner/)
- [GOV.UK Service Manual: How the alpha phase works](https://www.gov.uk/service-manual/agile-delivery/how-the-alpha-phase-works)
- [USWDS: Header](https://designsystem.digital.gov/components/header/)
- [USWDS: Table](https://designsystem.digital.gov/components/table/)
- [USWDS: Design principles](https://designsystem.digital.gov/design-principles/)
- [ONS Service Manual: Structuring content](https://service-manual.ons.gov.uk/content/writing-for-users/structuring-content)

### 原始网站案例

- [Tor Project](https://www.torproject.org/) 与 [Tor Browser 下载页](https://www.torproject.org/download/)
- [Mozilla](https://www.mozilla.org/) 与 [Firefox](https://www.firefox.com/en-US/)
- [Code for America：Social safety net](https://codeforamerica.org/programs/social-safety-net/) 与 [GetCalFresh](https://www.getcalfresh.org/en/)
