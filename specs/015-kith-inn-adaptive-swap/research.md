# 研究记录：kith-inn 自适应换菜

## 决策 1：复用 v1 的四级字典序评分语义，不跨项目 import

- **Decision**: 对每个有效候选计算 `[同周同菜, 同日同主料, 近7日同菜, 近7日同主料]` 次数，按字典序取最小者；胜出分量大于 0 的规则即 `relaxedRules`。
- **Rationale**: 这正是 #163 指定且在 v1 已被验证的产品优先级；计数比布尔值能在同一级冲突内继续择优。
- **Alternatives rejected**: 延续硬过滤会在小池误失败；加权总分可能用低优先级收益抵消高优先级冲突；跨 import 会耦合两个产品模型。

## 决策 2：候选资格与偏好评分分离

- **Decision**: 资格只保留“启用 + 同分类 + 非目标 + 当前餐未使用”；近期与主料冲突全部进入评分，不再过滤。
- **Rationale**: 只有资格条件属于不能违反的业务约束，避重是可放宽偏好；因此存在一个合格候选就应成功。
- **Alternatives rejected**: 把同餐主料继续做硬约束会破坏“仅一个候选仍可换”的验收。

## 决策 3：历史范围覆盖最近窗口与完整自然周

- **Decision**: 路由查询 `min(target-7d, weekMonday)` 至 `weekSunday` 的 menu plans，按 plan ID 排除当前 plan，再传给纯内核；近 7 日只计 target 前 1–7 日，同周则可计目标周内其他日期。
- **Rationale**: 一个范围同时完整支持四级规则；既有 CMS list 已 seller-scoped，无需新端点或 schema。
- **Alternatives rejected**: 只查过去 7 日会漏掉同周未来已排菜单；把当前 plan 留在历史会重复计算当前餐。

## 决策 4：解释是响应中的瞬时值

- **Decision**: 自动换菜成功总是返回有序 `relaxedRules`（可为空）；FE 把它映射成中文并在对应餐卡显示，本值不落 CMS。
- **Rationale**: 解释描述的是一次选择过程，持久化后会与后续换菜失配；页面可见提示满足“不静默放宽”。
- **Alternatives rejected**: 只写日志用户不可见；只用通用 toast 无法说明具体放宽；持久化需要无必要的数据迁移与生命周期设计。

## 决策 5：最小 H5 E2E 独立成片

- **Decision**: 为非 v1 FE 增加最小 Playwright config 和单一菜单换菜场景，复用现有 kith-inn seed、dev-login、CMS/BE/H5 webServer 模式与仓库 Playwright 版本。
- **Rationale**: #163 明确要求 H5 验收，且该设施可由 #157 继续扩展；独立 PR 避免领域/UI diff 超 review 预算。
- **Alternatives rejected**: 把 #157 的真实 PostgreSQL与跨租户全链路提前塞入会扩大当前 issue；mock 浏览器响应不能证明 BE/CMS 写回链路。
