# 周菜单横向滚动与对齐调研（2026-09-22）

范围：用户指出将周三拖到半列后，松手会突然将周三贴齐左侧餐次轴；希望了解类似应用是否通过过渡动画减轻突兀感。本次只调研、检查现有实现并提出建议，不修改产品代码。

## 结论

建议保留现有两天半布局与按日列对齐，让拖动紧跟手指或指针，释放后连续减速、平滑停到合适的日期边界。用户需要看见“内容移动到哪里”的过程，当前突然改变位置的问题应修在滚动行为上。无需新增提示文案，也无需把表格改为整屏翻页。

这是结合当前布局与官方滚动规范作出的设计判断。下面的竞品资料能证明按日浏览、按周翻页及保留滚动位置各有实际案例，不能证明它们使用同一种吸附动画或某个统一时长。

## 可核实的类似应用

| 应用与来源 | 官方明确描述 | 对本页的参考与证据边界 |
| --- | --- | --- |
| [Paprika 3 Android 用户指南：Meals](https://www.paprikaapp.com/help/android/#meals) | 菜单有日、周、月视图；可使用左右箭头切换，也可左右滑动切换前后周。 | 是按周导航案例，适合将整周作为一页的模式。指南未交代松手后的吸附曲线和时长，不能据此断言 Paprika 的过渡动画参数，也不能直接套到本项目一屏两天半的横向表格。 |
| [BusyCal 官方 Week View 指南](https://www.busymac.com/docs/busycal/70588-week-view/) | 左右箭头按周前进或后退；触控板双指左右滑动、Magic Mouse 单指左右滑动按天前后浏览。 | “逐日移动”是现成的日历交互，并非必须整周翻页。与本页按一天一列的结构更接近。文字资料未确认是否允许永久停在半列、何时吸附，以及具体动画曲线。 |
| [Plan to Eat 官方 App 更新记录](https://learn.plantoeat.com/en/help/app-release-notes) | 2.8.10（2021-11-11）说明切换标签时保存 Planner 滚动位置；只在从 Planner 外部选择日期时自动将事件滚入。3.2.4（2024-04-16）的更新还提到消除恢复已保存滚动位置时的视觉跳动。 | 能支持“用户所在位置应稳定，主动跳转应有明确原因”的设计取向。它们是官方历史改进记录，不能用来声称已实测当前版本的横向吸附动画。 |

本次没有登录这些应用、购买服务或根据静态截图推断动态效果。Apple Calendar、Fantastical 的公开帮助可确认多日/周视图，但本次未取得足以描述其松手吸附动效的直接证据，因此不将它们当作动画结论的依据。

## 平滑对齐的官方依据

[Apple WWDC23《Beyond scroll views》4:14 起的 Targets and positions](https://developer.apple.com/videos/play/wwdc2023/10159/) 区分三种行为：普通滚动根据速度和减速率确定终点；分页按容器大小决定终点；`viewAligned` 按具体内容项对齐。演讲同时展示让下一项露出边缘的布局。这为本页“保持半列提示、按日列平滑收尾”的方向提供了直接的平台案例，但不是对本项目时长的规定。

[Apple Human Interface Guidelines：Motion](https://developer.apple.com/design/human-interface-guidelines/motion) 的相关原则是动效简短、精确、跟随手势，并能被用户继续操作打断。对本页而言，动效应该帮助辨认移动方向和落点，不应增加弹跳或装饰性缩放。

[W3C CSS Overflow 3：Smooth Scrolling](https://www.w3.org/TR/css-overflow-3/#smooth-scrolling) 描述 `scroll-behavior` 对导航、滚动 API 及非用户触发的吸附滚动的作用；用户直接滚动不受该属性统一控制。因此不能声称单加 CSS `transition` 或一条 `scroll-behavior: smooth` 就能可靠解决所有鼠标、触控板和触屏路径。应检查实际触发对齐的代码，并让每条路径有且仅有一个负责落点的机制。

## 本地实现检查

检查位置：`apps/kith-inn-miniapp/src/lib/week-board.tsx`、`apps/kith-inn-miniapp/src/app.css`。

- H5 的 `.day-scroll` 使用 `scroll-snap-type: x mandatory`，日期列使用 `scroll-snap-align: start`。
- 鼠标拖动过程中添加 `.dragging` 暂停吸附，并直接写入 `scrollLeft`；松手的 `finish` 立即移除 `.dragging`，恢复吸附，没有显式安排平滑收尾。这解释了为何可能出现用户描述的突然贴齐；本结论基于代码与用户反馈，尚未进行逐帧测量。
- 非 H5 路径在停止滚动约 180 ms 后通过 `setScrollLeft` 对齐，没有设置 `scrollWithAnimation`。这里的 180 ms 是开始对齐前的等待，不是过渡动画时长。

## 面向当前两天半菜单表的建议

1. **拖动时同步移动。** 不给正在跟随手势的内容额外套一个慢动画，避免指针与菜品脱节。
2. **松手后连续收尾。** 先确定最终日期边界，再短促减速到落点；慢拖可取最近日列，快速甩动如保留原生惯性，应沿其方向和预测终点确定日列，避免停止后又突然反向跳一下。
3. **保留两天半和右侧渐变。** 左侧午晚餐轴不动；日期、菜品作为一个整体移动。到最末尾允许自然边界，不为了强求整列起点制造空白。
4. **保持选择与视口独立。** 滑动不切换所选菜品；点击当前可见菜品不重置到周一。新一次拖动应立即打断尚未完成的收尾动画。
5. **先验证约 180–240 ms 的短收尾。** 这是本项目可试调的范围，不是竞品实测值或行业标准；距离、原生滚动物理及减少动态效果偏好可能需要不同处理。

实施时应分别核对鼠标拖动、触控板惯性和真机触屏；至少覆盖半列释放、快速甩动、动画中再次拖动、最末列以及选择菜品后位置不变。当前尚未实施，也未把这些建议视为用户已验收的成品。

## 追加：能查到的确切参数

用户进一步询问具体数值后，查阅了公开源码。以下参数分别属于实际开源 App 和可复用组件，不能混称为 Paprika、BusyCal 等闭源产品的参数。

### Etar Calendar：实际开源日历 App，横向切日/切周动态计时

核对版本：`60b20da5eeb4418d55133f05affbbe75621aa9c9`。`DayView.switchViews` 用剩余横移距离、视图宽度和松手速度计算动画时长，不固定为 200 ms。曲线为 `1-(1-t)^5`，即五次缓出；计算速度的下限为 **2200 px/s**。经过距离修正后，时长为 `6*round(1000*abs(distance/velocity))` 毫秒。[调用处](https://github.com/Etar-Group/Etar-Calendar/blob/60b20da5eeb4418d55133f05affbbe75621aa9c9/app/src/main/java/com/android/calendar/DayView.java#L1847-L1911)、[曲线与计算函数](https://github.com/Etar-Group/Etar-Calendar/blob/60b20da5eeb4418d55133f05affbbe75621aa9c9/app/src/main/java/com/android/calendar/DayView.java#L5076-L5139)。

普通拖动释放、未触发 fling 时，横向位移超过视图宽度的 **1/7** 才切页。该实现切换的是完整日视图或周视图，不是本项目的小半列归位；低于阈值的回退分支也没有使用同一套平移动画，不应照搬全部行为。[阈值赋值](https://github.com/Etar-Group/Etar-Calendar/blob/60b20da5eeb4418d55133f05affbbe75621aa9c9/app/src/main/java/com/android/calendar/DayView.java#L1244)、[释放判断](https://github.com/Etar-Group/Etar-Calendar/blob/60b20da5eeb4418d55133f05affbbe75621aa9c9/app/src/main/java/com/android/calendar/DayView.java#L4372-L4413)。

特别注意：同文件中的 `GOTO_SCROLL_DURATION=200` 对应滚到指定时间的纵向操作，`ANIMATION_DURATION=400` 对应全天区展开；这两个数字都不能作为横向切周时长引用。

### TableCalendar：Flutter 日历组件，箭头翻页默认 300 ms

核对版本：`754c8fe728d70ad486132e22526008ff214b4398`。组件默认 `pageAnimationDuration` 为 **300 ms**，`pageAnimationCurve` 为 **easeOut**；Flutter 将该曲线定义为 **cubic-bezier(0, 0, 0.58, 1)**。[组件默认值](https://github.com/aleksanderwozniak/table_calendar/blob/754c8fe728d70ad486132e22526008ff214b4398/lib/src/table_calendar.dart#L244-L245)、[Flutter 曲线定义](https://api.flutter.dev/flutter/animation/Curves/easeOut-constant.html)。

这两个参数传给左右箭头点击后的 `previousPage` / `nextPage`；手势翻页另由 `PageView.builder` 的滚动物理处理。**300 ms 是按钮触发翻页的默认值，不是手指松开后的固定吸附时长**，也不是某款已发布 App 的实测值。[箭头调用处](https://github.com/aleksanderwozniak/table_calendar/blob/754c8fe728d70ad486132e22526008ff214b4398/lib/src/table_calendar.dart#L443-L455)、[手势视图](https://github.com/aleksanderwozniak/table_calendar/blob/754c8fe728d70ad486132e22526008ff214b4398/lib/src/widgets/calendar_core.dart#L60-L62)。

### 对当前方案的影响

有证据支持“缓出收尾”及“按速度、距离决定落点/时间”；没有证据支持所有应用都采用固定 200 ms。对于本项目最多补齐半列的短距离移动，先试约 **200 ms 缓出**仍是合理的候选，但须明确它是本项目试调值。若保留触屏原生惯性，应避免再叠一个固定计时动画与原生滚动物理互相争夺位置。

### 当前页面状态补记

上面的本地实现检查记录的是最初调研时的状态。主任务随后已加入 H5 平滑滚动及原生 `scrollWithAnimation`；H5 的具体时长仍由浏览器决定，不能将它描述为已固定到 200 ms。本次参数追问时检查到用户所在标签页仍使用旧版 `auto` 行为，主任务已另行展示更新版标签页。此处仅同步主任务的实现与版本核对结果，本次参数调研没有改产品代码。
