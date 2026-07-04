# 调研记录：kith-inn 菜单换菜 + 发群文案（持久化）

## 当前完成度快照

菜单**生成**与**确定性内核**已就绪：`generateWeekMenu`（纯函数，100% 单测）+ `swapDish`（确定性选替代，含主料避重 + 费工 + 邻槽 lookback）+ `publishMenuText`（LLM 群文案润色，可注入 generate）。读链路通：`GET /menu/week`（无状态生成建议）。FE 菜单 tab 能看（按餐次渲染 dishes + chips），「发群文案」按钮是 toast 占位。

缺口：**只能看不能改、不能发、不持久化**。`swapDish`/`publishMenuText` 已实现但**没被任何路由/页面调用**。`menu_plans` collection 在但无 cms internal route、无 be 客户端、无写入路径。FE 无换菜 / 发布 / 选择器 UI。

## 决策：发布落 menu_plans（评审选「乙 全套持久化」）

**理由**: 评审要 app 内留存（system of record）+ PRD §7.1「菜单发布=开餐」（发布要 upsert service_slots→open）。换菜本身在发布前是 in-session（纯 `POST /menu/swap`，FE 持有 menu），点「发布」才落库：每餐次 upsert `menu_plan`(offerings[], status=published) + upsert `service_slot`→open（复用 cms `service-slots/upsert`，archived→409 上抛）。

**考虑过的替代方案**:

- 甲（精简，不持久化）：换菜 + 发群文案全 in-session，不碰 menu_plans。被评审否决——要 app 内回看，且 §7.1 发布即开餐需要落 slot。
- 把整周菜单存成**一条** menu_plan：拒绝。collection `slot` 是 required relationship→service_slot（per 餐次），整周一条要么违反 schema、要么 slot 语义错。正确粒度是**每餐次一条**（周一午餐=1 plan）。

## 决策：换菜两模式，auto 复用 swapDish / 指定新增 swapDishSpecified

**理由**: `swapDish` 已覆盖 US-M04（一键换一道，确定性选替代、自带避重）；US-M05（指定换菜「把牛腩换成香菇滑鸡」）是不同操作——用户指定 replacement，系统只校验（在池内、非同菜）+ 算主料避重 warning、不替用户选。故新增纯函数 `swapDishSpecified({menu, target:{day,occasion,dishId}, replacementId, pool, constraints}) → {ok, replacement, warning?}`，复用 core 里既有的 lookback 计算避重（需把 `collectFrom`/`lookbackFrom` 等 helper 在文件内复用——同文件，不必单独 export）。

**两模式共用一个 be 端点** `POST /menu/swap`：不带 `replacementId` → `swapDish`（auto）；带 → `swapDishSpecified`（指定 + warning）。FE 按用户操作（「换一道」vs「选别的」）决定带不带。be 无状态、不落库；FE 把返回的 replacement 应用到 in-session menu。

**考虑过的替代方案**:

- 两模式拆两个端点：拒绝。共入参出参形状，一个端点 + optional replacementId 更简。
- 指定换不校验避重直接换：拒绝。PRD §6.2「用户强制指定优先、但提示可能破坏避重」，要 warning + 确认。

## 决策：publishText 每餐次按需生成、发布不调 LLM

**理由**: 桃子是「前一晚发**次日**菜单」（§1.2），不是整周一坨；按餐次按需生成（`POST /menu/plans/:id/publish-text`）最贴她的每日发帖节奏，且省 token（10 餐次只在用到的才调 LLM）。发布（`POST /menu/publish`）只落库、不调 LLM；publishText 字段初始空，首次复制时生成并写回，二次复制直接返回缓存（不重复调 LLM）。LLM 失败不阻塞发布（菜单已存，文案可重试）。

**考虑过的替代方案**:

- 发布时一次性生成整周 10 段文案：拒绝。10 次 LLM 成本 + 她只需明天的；按需更省。
- publishText 不存库、每次实时生成：拒绝。二次复制浪费 LLM；存 plan.publishText 天然缓存。

## 决策：M1 不做 draft、不做发布后换菜

**理由**: 桃子要么没发要么发了，无「草稿菜单」中间态；发布直接 `status=published`。`menu_plan.status` 字段保留但 M1 只写 published。发布后改菜单 = 编辑 published plan + 二次确认（§5.5），M1 不做——重新「发布」（upsert 覆盖）即等价于"改了再发"。draft 持久化 / post-publish 编辑 defer。

## 决策：菜单 tab 视图按「当周是否有 published」二分

**理由**: published 是 system of record，应优先显示。FE 进页面先 `GET /menu/published`：非空 → 只读 published + 每餐次「复制文案」；空 → `GET /menu/week` 建议页 + 「换一道」/「选别的」/「发布」。发布成功后切到 published 视图。日期切换 / 翻周 defer（M1 锁定当周）。

## 决策：周菜单 mon-fri → Asia/Shanghai 当周具体日期（新纯函数）

**理由**: `GET /menu/week` 返回的 MenuSlot.day 是抽象 mon-fri；publish 要写 `service_slot.date`（具体日期）、published 要按日期范围读。新增 be 纯函数 `resolveWeekDates(today, days)`：按 Asia/Shanghai 算 today 所属周的周一至周五日期。跨周 / 跨月 / DST 由 `Intl` + Asia/Shanghai 处理（仓库已有 `todayShanghai` 模式可参照）。100% 单测（含跨月边界）。

## 决策：写经 cms internal（新增 menu-plans route），复用 service-slots/offerings/seller

**理由**: TECH-SPEC §2 写不绕 Payload。menu_plans 还没有 cms internal route——新增 `GET /api/internal/menu-plans`（?from=&to=，depth）、`POST /api/internal/menu-plans/upsert`（按 (seller, slot)）、`PATCH /api/internal/menu-plans/:id`（publishText，find-then-update 跨租户 404）。publish 的 slot 开餐直接复用既有 `POST /api/internal/service-slots/upsert`（archived→409 已在）。seller 配置（sellerName/priceCents）复用 `GET /api/internal/seller`。菜品池复用 `GET /api/internal/offerings`。BE↔cms 用 operatorScope + seller 钉死，无 admin key。

**已知缺口（同 feature 002，沿用 issue #110）**: cms 写 route 的跨租户 404 靠 handler 内手写 `where:{seller}` + find-then-update，无自动化断言；payload 包 access/hook 单测兜底。menu-plans upsert/PATCH 同形态。

## 决策：fe 换菜用整体 refetch 不适用——in-session 纯函数 applySwap

**理由**: 换菜是 in-session（发布前不落库），FE 持有 menu 状态，每次 swap 拿 be 返回的 replacement 用纯函数 `applySwap(menu, target, replacement)` 在前端生成新 menu（不可变更新）。不走 refetch（没落库，refetch 会重生成建议、丢失其它换菜）。发布后才 refetch（切 published 视图）。
