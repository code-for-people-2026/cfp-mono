# 数据模型：商家菜品库视图状态

本功能不修改持久化数据模型，仅定义客户端状态及约束。

## Offering（既有实体）

- 稳定标识 `id`
- 名称 `name`
- 可选主料 `mainIngredient`
- 分类 `meat | veg | soup`
- 启用状态 `active`

**约束**：编辑结果按 `id` 原位替换；新增结果追加；任一菜品的旧响应不得覆盖较新的本地意图。

## OfferingsViewState

- `view`: `browse | manage`
- `filter`: `all | meat | veg | soup`
- `offerings`: 保持服务顺序的菜品数组
- `pendingToggleIds`: 正在启停的菜品标识集合
- `toggleRevisions`: 每道菜单调递增的请求版本

## ImportDraftState

- `text`: 当前原文
- `revision`: 原文变化时递增
- `preview`: 可选预览结果
- `previewRevision`: 生成当前预览的原文版本
- `conflicts`: 当前预览的覆盖选择
- `commit`: 可选提交结果
- `commitPending`: 提交请求是否正在使用已确认的原文与冲突选择快照

**状态转换**：非提交期间修改原文 → revision 递增并清空 preview/conflicts/commit；预览成功仅在版本仍匹配时写入；提交仅在 `previewRevision === revision` 时允许。提交开始 → `commitPending = true` 并锁定 text/conflicts；请求结束 → 先按捕获快照判断是否展示结果，再解除锁定。客户端不得在 commit pending 期间推进原文版本，避免已发送的旧文本仍在服务端写入。
