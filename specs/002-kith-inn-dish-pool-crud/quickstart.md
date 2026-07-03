# 快速验证：kith-inn 菜品池 CRUD

## 自动化检查

运行本功能相关的窄检查：

```bash
pnpm --filter @cfp/kith-inn-shared test
pnpm --filter @cfp/kith-inn-be test
pnpm --filter @cfp/kith-inn-fe test
```

预期结果：

- shared schema tests 覆盖 `offeringCreateSchema`（name 必填、mainIngredient 可选、category 必填限枚举、多余字段被丢弃）、`offeringUpdateSchema`（只接受 name/mainIngredient/category、空对象非法、category 给了须合法）。
- be `lib/cms/offerings.test.ts` 证明 `createOffering`/`updateOffering`/`deactivateOffering`/`restoreOffering` 向 cms 发正确的 POST/PATCH/DELETE/POST（URL、method、body 只含白名单字段、`x-kith-inn-operator` 头），非 2xx 抛 `CmsHttpError`。
- be `routes/offerings.test.ts` 证明：GET 过滤 `kind=component`（保留 active=false）；POST 校验 name+category 必填（400）、转发 cms、返回 201；PATCH 校验白名单 + 空体 400、转发、返回 200；DELETE → `{ok:true}`；`POST /:id/restore` → `{ok:true}`；全部 401 无 token。
- fe `logic/offeringsCrud.test.ts` 证明 create/update/deactivate/restore 调对 URL+method+body，`partitionByActive` 正确分两区（注入式 request mock）。
- `apps/cms` 无新增单测（路由 handler 是 glue，由 be 侧 mocked-fetch 覆盖契约；cms vitest 仅含 `tests/**`）。cms 写 route 真实多租户隔离测试单列 issue。
- `pnpm --filter @cfp/kith-inn-payload test` 仍通过（本 feature 不改 collection/access/hooks）。

完整门禁：

```bash
pnpm verify   # lint + typecheck + 100% 覆盖 + knip + build
```

## 手动冒烟测试（H5）

1. 启动 cms（`pnpm --filter @cfp/cms dev`，确保 push 同步 + ensureConstraints）+ be（`apps/kith-inn-be`）+ fe H5。
2. 登录桃子灶台，进「菜品池」（kitchen 页）。
3. **新增**：点新增 → 填「蒜蓉空心菜」/ 主料「青菜」/ 分类「素」→ 提交 → 列表新增，归「主料 · 青菜」。再试只填菜名+分类（不填主料）→ 归「其他」。再试空菜名或未选分类 → 被拒。
4. **编辑**：点「番茄炒蛋」编辑 → 改名「西红柿炒蛋」→ 列表对应行更新（id 不变）。改主料「鸡蛋」→「番茄」→ 分组迁移。把分类从「素」改「荤」→ 重新生成菜单时进荤位（分类可纠错）。试清空菜名 → 被拒。
5. **删除（软停用）**：点「蒜蓉空心菜」删除 → 确认 → 它从「菜品池」区消失、出现在「已停用」区。重开页面分区不变。
6. **删除不影响菜单/引用**：删除后进菜单 tab 生成一周菜单 → 该菜不在候选；若该菜曾被订单/菜单引用，订单/菜单仍能展示该菜名（doc 仍在，仅 active=false）。
7. **恢复**：在「已停用」区点「蒜蓉空心菜」的「恢复」→ 它回到「菜品池」区；再次生成菜单 → 重新进入候选。
8. **幂等**：对已停用的菜再点删除、对已启用的菜再点恢复 → 均成功返回，状态不反复。
9. **跨租户**（可选，需第二个 seller）：用 A 的 token PATCH/DELETE/restore B 的 offering id → 404。

## 明确不做（deferred）

- combo-meal 套餐管理、`parentOfferings` 组合编辑（菜品池只动 component）。
- 物理删除 + 批量清理（M1 只做软停用 + 恢复）。
- 批量导入 / 群历史导出加速。
- 采购聚合（`recipe`）。
- 「今天」主对话 agent 口头增删改菜品池（agent tool 注册属另一 feature）。
- 并发冲突处理（M1 单操作者）。
- category 后端推断（已放弃，改用户录入）。
- cms 写 route 真实 postgres 多租户隔离测试（单列 issue）。
