# 调研记录：kith-inn 菜单编辑 + 接龙发布

## 当前完成度快照

生成内核（`generateWeekMenu`/`swapDish`）就绪且有单测；`GET /menu/week` 无状态生成；`publishMenuText`（LLM）已实现但无人调用；FE 菜单 tab 只读、「发群文案」是 toast 占位。`menu_plans` collection 在但无 cms internal route / be 客户端 / 写入路径。

## 决策：单位是餐次、date-driven、砍"周"硬骨架（评审第 1 轮）

`menu_plan`/`service_slot` 本就按 (date,occasion)。初版把 mon-fri×午晚=10 当硬骨架是错的——桃子的"周"是松散参考（周末做菜、感冒停做、只发明天）。改 date-driven：`MenuSlot` 用具体 date；`generate` 吃 targets 列表；砍 `resolveWeekDates`；"周"降级为周视图的一个日期范围 preset。

## 决策：生成直接写 draft（评审第 2-3 轮）

初版"生成是 in-session 建议、发布才落库"无法支撑"周日排好、周四回来改"（in-session 跨刷新即丢）。改：`generate` 直接 upsert **draft** plan（落库、暂定）。draft 随意编辑（覆写）。砍掉"先建议后保存"两段式——draft 自由编辑即等价 review。

## 决策：请回 draft/published 状态机（评审第 4 轮，纠初版"不做 draft"之错）

桃子要"暂定 vs 已发出"区分（发出去前后编辑心智不同）。draft=暂定（随意改）；published=已发出（颜色提示、改要二次确认）。`menu_plan.status` 本就有 draft/published 枚举——M1 真正用上。编辑 published plan：caller（panel modal / 004 agent 确认卡）二次确认 → 带 `force:true` 调 be；be 无 force → **409**（同 archived-slot 守卫模式，但这里是 plan 级、caller 侧确认）。改 published plan 的菜 → publishText 自动清空（接龙过期）。

## 决策：一键发布 = 接龙文案 + 复制 + 标记（评审第 4-6 轮）

「发布」语义=她把菜单"发出去给顾客看"。但小程序无群发 API + 无消费者端 → app 不能真发微信群。故一键发布 = 生成**接龙格式**文案 + 复制剪贴板 + draft→published（颜色变化）+ 提示"去群粘贴"。"已发出"是她点按钮的 intent 标记；真贴群 offline。再次「复制文案」→ 返缓存 publishText（不重生成）。

## 决策：接龙文案用确定性模板，去 LLM（评审第 6 轮）

初版 `publishMenuText` 走 DeepSeek 写"老板语气通知"。评审指出桃子要的是**接龙格式**（结构化、顾客能接龙下单），不是语气润色 → **纯模板拼接**（`buildJielongMenuText`：日期+菜名+价格+截止+接龙起始行），M1 **不调 DeepSeek**。收益：feature 003 零 LLM 依赖、无失败模式（FR "LLM 失败不阻塞"消失）、可单测。`polish.ts` 暂留 unused（未来"语气润色"可选启用）。格式需桃子真实接龙样本校准（follow-up，不阻塞）。

## 决策：日/周双视图分治（评审第 3 轮）

日视图（默认今天、左右滑、单日/单餐操作）；周视图（toggle、N 天网格、**只生成 draft 不批量发出**——发出按餐次日视图做）。周视图点某天 → 跳该天日视图（桥接）。砍掉初版的 `focusMeals` 时间启发式（让桃子滑、不猜）。

## 决策：菜单流程不开餐（评审简化）

初版 publish 复用 `service-slots/upsert`→open（PRD §7.1 菜单发布=开餐）→ 引入 archived-409 + partial-publish 复杂度（#114 Codex P1）。重新审视：M1 slot open 的运营意义是"有确认订单要送"，由**订单确认**触发即可；菜单生成/发布只需 slot 存在（供 menu_plan.slot 引用）。故 `generate` 仅 **ensure slot 存在**（缺则建 draft、不动既有 status），**不改 slot.status**。→ 砍 archived/force-slot、砍 partial-publish、砍 #114 P1。slot 开餐归订单确认不变。

## 决策：范围拆 003（be+panel）/ 004（agent）

US-M06「今天口头改菜单」需要菜单工具注册 + 确认卡流程，是 §6.2 的 agent 半边。拆出 feature 004（薄，消费 003 的 be 端点）。003 单独就让桃子能用菜单 tab 出菜单。

## 已知缺口（同 #110，沿用）

cms 写 route 跨租户 409/404 靠 handler 内 `where:{seller}` + find-then-update，无自动化断言；payload 包 access/hook 单测兜底。menu-plans upsert/PATCH 同形态。
