# 历史菜单页面调研（2026-09-22）

范围：用户标注的日期、餐数、保存状态与复制入口。依据当前历史页截图和下列官方文档；产品截图不是用户测试，不能据此声称某种文案已被证明更易懂。本笔记不修改界面或业务规则。

## 官方案例与证据

| 应用 | 核实到的设计 | 对本页的参考与限制 |
| --- | --- | --- |
| Paprika | 官方 iOS 3 指南的周视图截图顶部为 `Nov 12, 2017 - Nov 18, 2017`；每天标题仍显示 `Sun, Nov 12`、`Mon, Nov 13`、`Tue, Nov 14`。指南说明用左右箭头切换周。 | 周范围与逐日日期承担不同层级的定位作用，可以并存。截图内容是旧版示例，不能称为 2026 年最新版截图。[官方指南](https://www.paprikaapp.com/help/ios/#meals)、[已目视核对的官方截图](https://www.paprikaapp.com/static/images/help/ios/meals_weekly.png)。 |
| AnyList | 官方帮助说明，选择菜品后点 Copy，再选择新日期；官方日期选择截图标题为 `Select Date`，下面是月份和完整日历。模板应用流程还会预览每一天映射到的日期，再执行 Add to Calendar。 | “复制 → 选择目标日期 → 确认”有直接案例；不是无提示地固定复制到下一周。[复制流程](https://help.anylist.com/articles/meal-planning-calendar-bulk-move-copy-recipe/)、[已目视核对的日期选择截图](https://help.anylist.com/img/articles/meal-planning-calendar/move-copy-recipe-5.png)、[模板预览说明](https://help.anylist.com/articles/meal-plan-templates/)。 |
| Plan to Eat | 已保存菜单先预览，点击 Plan Menu，选择开始日期，再点 Add。另一条批量操作路径是 Duplicate 后用 Reschedule 指定新日期范围。 | 复用源菜单和目标日期分开确认，适合本项目整周复制。两条流程不同，不应误写成 Duplicate 按一下就一定直接弹日期选择器。[复用菜单流程](https://learn.plantoeat.com/help/app-using-menus-in-the-plan-tab)、[批量复制与改期](https://learn.plantoeat.com/help/bulk-edit-your-meal-plan-app)。 |
| Samsung Food | 官方说明把 Plan、Queue、Previous 分开；Previous 指过去安排过的菜。Saved plans 则是用户另外命名保存、供未来复用的菜单。官方 Plan 示例截图使用 `This week`、`Yesterday`、`Today`、`Tomorrow`。 | 相对时间不是一概不可以，但要和当前任务匹配；过去安排与另存模板不是同一状态。本次未成功看清 Previous 截图，因此不声称其历史页具体怎样排日期。[功能说明](https://support.samsungfood.com/hc/en-us/articles/35369657798548-Getting-Started-with-Meal-Planner)、[改版说明](https://support.samsungfood.com/hc/en-us/articles/35375178365716-What-s-Changed-in-the-Samsung-Food-Meal-Planner)、[已目视核对的 Plan 示例](https://support.samsungfood.com/hc/article_attachments/35375178317588)。 |

## 对当前四处标注的建议

1. **保留“周一 + 9/14”**。这里是有真实日期的历史菜单，用户可能跨周查菜；只有周一、周二会要求用户从顶部周范围自行推算日期。日期可以是次要字号和颜色，也可以与星期排成紧凑一行，减少高度不必删掉定位信息。无日期的固定每周模板才更适合只写星期。
2. **移除“7 天 · 14 餐”**。它是统计摘要，严格说不只是解释性文本；但本页主要任务是查阅和复用，日期范围、每天列、午晚餐分组已经表达结构。统计不能帮助用户完成当前操作时可省去。这是本项目的取舍，不是调研证明所有竞品都不显示统计。
3. **主标题保留明确周范围，移除“上周 · 已保存”**。顶部 `9月14日—20日` 已定位所查看的一周；“已保存”对只展示已保存记录的页面没有区分价值。相对“上周”会随今天变化，长期历史检索宜依赖稳定日期；跨年或非当前年份应包含年份。无需另补一行“历史菜单”等同义说明。若未来混有草稿，才在有状态差异的记录上明确标记。
4. **建议入口“复制这周菜单”，点击后“复制到哪一周”**。用户提出的“复制”比“沿用”直接，但“本周”通常指今天所在的自然周；截图展示的是 9/14–9/20，上方还标过“上周”，因此“复制本周菜单”可能指错源。这里的“这周”明确指当前所查看的菜单；若希望完全避免歧义，可用“复制到其他周”。目标选择处显示具体日期范围，并在确认按钮或摘要中带目标日期，例如“复制到 9月28日—10月4日”。源菜单不变；目标已有内容时沿用现有覆盖保护。复制菜单文字到剪贴板的动作继续叫“复制菜单文字”。

以上为基于官方案例及本项目上下文的建议，尚不代表用户确认全部调整；本次没有登录竞品账户、操作真实菜单或开展可用性测试。
