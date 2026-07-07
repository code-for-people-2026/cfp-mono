---
description: "kith-inn 订单页逐行勾选批量勾销 + 地址大小写不敏感 + 删语音勾销 实现任务"
---

# Tasks：订单页批量勾销交互改造（#007）

**输入**: `specs/007-kith-inn-orders-bulk-checkout/` 下的 spec.md / plan.md（轻量档，无 research/contracts）

**测试策略**: shared（addressMatches 纯函数）；fe（ordersLifecycle 纯函数 + orders 页选择/批量逻辑 mock Taro.request）；be（删除后覆盖仍 100%）。cms 不动。

## Format：`[ID] [P?] Description`

## Phase 1：地址匹配大小写不敏感（可独立先发的小 PR）

- [ ] T001 [P] `packages/kith-inn-shared/src/addressMatch.ts`：`addressMatches` 字母分支改 `address.toLowerCase().startsWith(a.toLowerCase())`；纯数字分支不动。补/改单测：`3a` 匹 `3A-1201`、`3A` 匹 `3a27b`、纯数字 `3` 仍只匹楼栋 3（不匹 `30A`）、前缀不退化成 substring（`3a` 不匹 `2d03a`）。
- [ ] T002 [P] `apps/kith-inn-fe/src/logic/ordersLifecycle.ts`：内联副本 `addressMatches`（:6-14）同步改（keep-in-sync 注释已要求）；ordersLifecycle 单测加大小写用例。

## Phase 2：订单页逐行勾选 + 批量送达（FE 主体）

- [ ] T003 [P] `apps/kith-inn-fe/src/logic/ordersLifecycle.ts` 加 selection 纯函数：`toggleSelection(ids: (string|number)[], id)`（返新数组，去重 toggle）、`selectableRows(rows, occasion)`（当前餐次 + `lifecycleDots`.base≠canceled + delivery=pending）。单测。
- [ ] T004 `apps/kith-inn-fe/src/pages/orders/index.tsx`：加 `const [selected, setSelected] = useState<Set<string|number>>(new Set())`；selectable 行整行（或勾选格）tap → toggle；顶部条「已选 N · [批量送达]」（N=0 禁用）；批量送达 → `act(markDeliveredUrl(), "PATCH", { ids: [...selected], set:{status:"done"} })` → 成功后清 selected + reload（`act` 已 reload）。切 occasion / 改 prefix 时 `setSelected(new Set())`。
- [ ] T005 过滤输入保留作「缩候选集」（`previewAddressMatch` 仍用于决定哪些行渲染/可勾），不再是提交机制；删旧 `batchDeliver` 的 modal 逻辑。per-row「标送达」按钮（:170）保留不变。
- [ ] T006 FE 测试：ordersLifecycle 新 selection 函数；orders 页勾选/清空/切餐次清选择/批量 PATCH（mock `Taro.request` 验 `{ids}`）。

## Phase 3：删 agent mark_delivered 语音工具整链

- [ ] T007 `apps/kith-inn-be/src/agent/tools.ts`：删 `mark_delivered` 工具（:175-183）+ `AgentServices.markDelivered`（:27）+ `previewDelivered`（:40）类型。
- [ ] T008 `apps/kith-inn-be/src/agent/services.ts`：删 `markDelivered`（:206-210）+ `previewDelivered`（:412-419）。
- [ ] T009 `apps/kith-inn-be/src/agent/run.ts`：prompt 能力清单去 `mark_delivered（地址）`、写操作纪律列举去「标送达」。
- [ ] T010 `apps/kith-inn-be/src/routes/chat.ts`：删 `case "mark_delivered"`（:206-209）。
- [ ] T011 删测试：`services.test.ts` 的 `markDelivered` describe + `previewDelivered` 用例；`chat.test.ts` 的 `mark_delivered` dispatch 用例 + svc mock 里的 `markDelivered`。

## Phase 4：删 delivery.ts 死的 {address} 模式 + 注释

- [ ] T012 grep 复确认零 FE 调用 `{address}`（已知 today:193 / orders:99 / orders:171 全 `{ids}`）→ 删 `apps/kith-inn-be/src/routes/delivery.ts:51-58` 的 address 分支 + 收紧 :19-23 注释（去「agent/语音用」「取代 agent tool-call」字样，只留 `{ids}` 说明）；`apps/kith-inn-be/src/domain/delivery/derivations.ts:58` 注释去「agent's mark_delivered」。删完 `grep -rE "mark_delivered|markDelivered|previewDelivered" apps/kith-inn-be/src/` 应无残留（除可选历史注释）。

## Phase 5：门禁 + PR

- [ ] T013 `pnpm verify` 全绿（FE 100% 覆盖含新 selection；be 删除后仍 100%）。
- [ ] T014 起 `feat/kith-inn-orders-bulk-checkout`（off 最新 main，**等 PR #131 合后**）→ verify → push → 开 PR(base=main) → Codex review（不自动触发就 `@codex review`）→ 逐条 resolve → CI 绿 → `gh pr merge --rebase --delete-branch`。Conventional commit：`feat(kith-inn): 订单页逐行勾选批量勾销 + 地址大小写不敏感 + 删语音勾销（#007）`。建议拆 2 PR：① T001-T002 大小写快修；② T003-T012 主体。

## Dependencies

- Phase 1（大小写）无依赖，可独立先发。
- Phase 2（select-bulk）依赖 Phase 1（新 UX 也要 case 归一化才能搜出 3A）。
- Phase 3（删 agent）/ Phase 4（删 {address} 模式）彼此独立、也独立于 FE，可并行；Phase 4 依赖 Phase 3（agent 删了 `{address}` 才彻底无调用方，删得更安心）。
- Phase 5 最后。

## Out of Scope

跨日 / 跨餐次批量勾销；选择状态持久化；「全选当前过滤集」按钮；顾客端分享卡（M3/V1）；语音勾销（本 feature 删除）；订单日/周视图（另开 feature）。
