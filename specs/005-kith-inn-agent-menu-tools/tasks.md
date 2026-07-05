---
description: "kith-inn agent 菜单工具（US-M06）实现任务"
---

# Tasks：「今天」agent 菜单工具（US-M06）

**输入**: `specs/005-kith-inn-agent-menu-tools/spec.md`

**测试策略**: be-only；AgentServices DI mock；工具 execute handler 纯逻辑可单测；run.ts 编排用 mock LLM + 脚本化工具序列。

## Phase 1：AgentServices 接口 + 实现 + 测试

- [ ] T001 在 `apps/kith-inn-be/src/agent/services.ts` 的 `AgentServices` 接口加 4 方法签名：
  ```ts
  generateMenu(targets: Array<{ date: string; occasion: "lunch"|"dinner" }>, force?: boolean): Promise<{ ok: true; plans: MenuPlanView[] } | { ok: false; reason: string }>;
  swapDish(planId: string|number, dishId: string|number, replacementId?: string|number, force?: boolean): Promise<{ ok: true; plan: MenuPlanView; warning?: string } | { ok: false; error: string }>;
  publishMenu(planId: string|number): Promise<{ ok: true; publishText: string } | { ok: false; error: string }>;
  getMenu(date?: string): Promise<MenuPlanView[]>;
  ```
- [ ] T002 在 `services.ts` 的生产实现（`createCmsAgentServices`）里实现这 4 方法——各调 **be 菜单路由端点**（`POST /menu/generate`、`POST /menu/plans/:id/swap`、`POST /menu/plans/:id/publish`、`GET /menu/plans`）。注意：这些是 **be 路由**（`sellerAuth` 保护），不是 cms internal route——用 **be base URL + `Authorization: Bearer ${jwt}`**（不是 cmsBase + OPERATOR_JWT_HEADER，Codex #121 P2）。be base URL 可从 `process.env.BE_BASE_URL` 或与 be 自身同进程（agent 在 be 内运行 → 可直接调 `menuRoutes` 的 Hono `app.request()`，免 HTTP 往返）。
- [ ] T003 在 `services.test.ts` 加 4 方法的 mock-cms 用例：
  - generateMenu：正常返回 plans；pool-too-small 返 `{ok:false, reason}`；published 无 force 返 409。
  - swapDish：auto 模式（无 replacementId）；指定模式；published 无 force 返 409。
  - publishMenu：返回接龙文案；跨租户 404。
  - getMenu：返回 plan 列表；空返 []。

## Phase 2：工具定义 + execute handler + 测试

- [ ] T004 在 `apps/kith-inn-be/src/agent/tools.ts` 的 `AGENT_TOOLS` 数组加 4 工具：
  - `generate_menu`：参数 `{ targets: [{date, occasion}], force? }`；execute 调 `svc.generateMenu` → 返 `{ text: "排好了：菜1、菜2…", card? }`。pool-too-small → `{ text: "菜品池不够…" }`。
  - `swap_dish`：参数 `{ planId, dishId, replacementId?, force? }`；execute 调 `svc.swapDish` → 返 `{ text: "换成了{replacement.name}" , warning? }`。409 → `{ text: "这餐已发给顾客，确定要换吗？" }`。
  - `publish_menu`：参数 `{ planId }`；execute 调 `svc.publishMenu` → 返 `{ text: 接龙文案全文 }`。
  - `get_menu`：参数 `{ date? }`；execute 调 `svc.getMenu` → 返 `{ text: "明天午餐：菜1、菜2…\n明天晚餐：…" }`。空 → `{ text: "还没有排菜单" }`。
- [ ] T005 在 `tools.test.ts`（如存在）或新建 `agent/menuTools.test.ts` 加 execute handler 用例（mock AgentServices + 断言返回 text/card）。

## Phase 3：run.ts prompt + 集成测试

- [ ] T006 在 `apps/kith-inn-be/src/agent/run.ts` 的 system prompt 加菜单能力描述段落（"你可以帮桃子管理菜单：生成、换菜、发布（发群文案）、查看"）。
- [ ] T007 在 `run.test.ts` 加脚本化用例：mock LLM 返回 `generate_menu` tool_call → 执行 → 断言 reply 含菜名。一条够（证明工具被发现 + 执行）。

## Phase 3.5：可靠性加固（PRD §5.5 补缺）

- [ ] T007a 在 `packages/kith-inn-shared/src/schemas.ts` 的 `cardPayloadSchema` 加 `{ type: "operation-confirm", data: { toolName: string; summary: string; args: Record<string, unknown> } }`。types.ts 推导。
- [ ] T007b 在 `apps/kith-inn-be/src/agent/pendingState.ts`（或新建 `pendingOps.ts`）加 per-operator pending operation 机制（同 pendingState 模式）：`setPendingOp(operatorId, { toolName, args, summary })` / `getPendingOp(operatorId)` / `clearPendingOp(operatorId)`。
- [ ] T007c 在 `apps/kith-inn-be/src/routes/chat.ts` 加 `POST /chat/confirm-operation`（同 `confirm-customers` 模式）：取 pending op → 确认 args 匹配 → 执行对应 AgentServices 方法 → 清 pending → 返回结果。
- [ ] T008 修改**重操作**的 execute handler（confirm_order、cancel_order、generate_menu force、swap_dish published、publish_menu）→ 检测"需要确认"→ 存 pending op → 返 `{ text: "将{动作}：{summary}，确认？", card: operation-confirm }`。
- [ ] T009 所有工具 execute handler 入口加 zod safeParse（用 shared schema 校验 LLM 填的参数）；现有手动 coerce（parseOccasion/parseOrderItems）保留作 fallback。
- [ ] T010 在 `tools.test.ts` 加用例：重操作 → 返确认卡（不直接执行）；确认后 → 执行；轻操作 → 直接执行。zod safeParse 挡非法参数。

## Phase 4：门禁 + PR

- [ ] T011 `pnpm verify`（lint/typecheck/100% 覆盖/knip/build）全绿；PR 描述记录；遵守 AGENTS.md PR/Codex review 流程。

## Dependencies

- Phase 1 无依赖（services 接口 + 实现）。
- Phase 2 依赖 Phase 1（工具调 services）。
- Phase 3 依赖 Phase 1+2（run.ts 注册 + prompt）。
- Phase 3.5（可靠性加固）依赖 Phase 2（改 execute handler）；3.5a/b/c 可与 3 并行。
- Phase 4 全部完成后。

## Out of Scope

跨日菜单查询、FE 选择器、结构化 card（接龙文案直接文字展示）、LLM 选替代菜的准确率 eval（后续质量加固）。
