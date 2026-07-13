# 研究记录：kith-inn 自适应换菜

## 决策 1：复用 v1 的四级字典序评分语义，不跨项目 import

- **Decision**: 对每个有效候选计算 `[同周同菜, 同日同主料, 近7日同菜, 近7日同主料]` 次数，按字典序取最小者；胜出分量大于 0 的规则即 `relaxedRules`。
- **Rationale**: 这正是 #163 指定且在 v1 已被验证的产品优先级；计数比布尔值能在同一级冲突内继续择优。
- **Alternatives rejected**: 延续硬过滤会在小池误失败；加权总分可能用低优先级收益抵消高优先级冲突；跨 import 会耦合两个产品模型。

## 决策 2：候选资格与偏好评分分离

- **Decision**: 资格只保留“启用 + 同分类 + 非目标 + 当前餐未使用”；近期与主料冲突全部进入评分，不再过滤。
- **Rationale**: 只有资格条件属于不能违反的业务约束，避重是可放宽偏好；因此存在一个合格候选就应成功。
- **Alternatives rejected**: 把同餐主料继续做硬约束会破坏“仅一个候选仍可换”的验收。

## 决策 3：所有自动换菜前门共享历史语义

- **Decision**: menu route、chat `swapDish` 与 `previewSwap` 都查询 `min(target-7d, weekMonday)` 至 `weekSunday` 的 menu plans，按 plan ID 排除当前 plan，再传给纯内核；chat preview 把胜出 replacement 固化到确认参数。
- **Rationale**: 一个范围同时完整支持四级规则；两个产品前门不会因调用路径不同给出不同结果；既有 CMS list 已 seller-scoped。
- **Alternatives rejected**: 只改 route 会让 chat 绕过历史；只查过去 7 日会漏掉同周未来已排菜单；确认时重新自动选择会因随机或历史变化偏离确认卡。

## 决策 4：用位置标识保证只替换一个 occurrence

- **Decision**: API 接受可选零起始 `dishIndex`；提供时校验该位置的 ID，省略时兼容地选择第一个匹配项。领域成功结果返回 `targetIndex`，route/agent 复制 offerings 后只写该下标。
- **Rationale**: `menu_plans.offerings` 是无唯一约束的 hasMany，现有数据和指定换菜都可能产生重复 ID，单靠 `dishId` 无法表达点击位置。
- **Alternatives rejected**: 新增 DB/schema 唯一约束超出范围且数组元素唯一无法直接由现有索引保证；禁止指定重复会改变“用户选择优先”。

## 决策 5：解释是响应中的瞬时值并在边界做 runtime 校验

- **Decision**: 自动换菜成功总是返回有序 `relaxedRules`（可为空）；H5 先用 shared success schema 解析响应，再映射中文并在对应餐卡显示；chat 确认卡消费同一规则集合；本值不落 CMS。
- **Rationale**: 解释描述的是一次选择过程，持久化后会与后续换菜失配；页面可见提示满足“不静默放宽”。
- **Alternatives rejected**: TypeScript 类型断言不能防后端回归或版本错配；只写日志用户不可见；持久化需要无必要的数据迁移与生命周期设计。

## 决策 6：最小 H5 E2E 独立成片

- **Decision**: 为非 v1 FE 增加最小 Playwright config 和单一菜单换菜场景，复用现有 kith-inn seed、dev-login、CMS/BE/H5 webServer 模式与仓库 Playwright 版本。
- **Rationale**: #163 明确要求 H5 验收，且该设施可由 #157 继续扩展；独立 PR 避免领域/UI diff 超 review 预算。
- **Alternatives rejected**: 把 #157 的真实 PostgreSQL与跨租户全链路提前塞入会扩大当前 issue；mock 浏览器响应不能证明 BE/CMS 写回链路。
