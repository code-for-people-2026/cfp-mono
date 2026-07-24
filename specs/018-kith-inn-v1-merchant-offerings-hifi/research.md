# 研究结论：商家菜品库高保真重构

## 决策 1：保留 Kimi 页面骨架，局部重构状态协调

- **Decision**：保留已完成的浏览/管理/弹层 JSX、筛选纯逻辑和主体 CSS，只替换存在竞态的请求状态与列表合并逻辑。
- **Rationale**：现有成果已通过真实 CRUD、E2E 和双端构建；重新实现会扩大回归面。
- **Alternatives considered**：从主线旧页面重写；代价更高且不能改善既有 API 风险。

## 决策 2：逐菜品 pending 集合加逐项 revision

- **Decision**：每道菜独立记录 pending 与 revision，只有最新 revision 可以写入结果和释放自己的 pending 状态。
- **Rationale**：不同菜品可并行，同一菜品避免重复请求，且不会被其他菜品请求的 `finally` 提前解锁。
- **Alternatives considered**：单一 `togglingId` 无法表达并发；全局串行会无谓阻塞其他菜品。

## 决策 3：导入原文采用单调递增版本

- **Decision**：原文每次变化都推进版本；预览和提交捕获原文快照与版本，只允许当前版本更新 UI，提交前还要验证预览版本匹配。
- **Rationale**：冲突选择按行号解释，陈旧预览可能把覆盖选择应用到另一道菜。
- **Alternatives considered**：仅在输入事件中清空预览不能阻止飞行中的旧响应重新写回。

## 决策 4：编辑原位替换，新增才追加

- **Decision**：抽取纯函数按操作模式合并保存结果；edit 使用 `map` 原位替换，create 追加。
- **Rationale**：保持服务返回顺序和用户上下文，无需引入排序字段。
- **Alternatives considered**：保存后整表 reload 会增加延迟且可能丢失局部交互状态。

## 决策 5：不改变接口与设计资产提交边界

- **Decision**：沿用现有菜品和导入 API；运行时代码 PR 不包含 Prompt，PNG/HTML 如需入库单独走 docs PR。
- **Rationale**：本功能风险集中在客户端状态和视觉，不需要扩大跨层范围。
- **Alternatives considered**：让后端签发 preview token 会改变 API，超出本次目标。
