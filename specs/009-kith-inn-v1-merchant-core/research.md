# Research：街坊味 v1 商家核心闭环

## 1. M1 交付与 PR 切分

**Decision**: 一个规格覆盖 M1。M1-A“登录+菜品池”和 M1-B“菜单”已经分别完成；剩余订单按 M1-C1“顾客资料+草稿补单”、M1-C2“订单生命周期”、M1-C3“批量送达+清单收口”三个顺序纵向 PR 实施。每个 PR 等前一个 rebase merge 后从最新 `main` 开始。

**Rationale**: #146 的 M1-B 实践表明，把完整跨层用户故事放进一个 PR 仍会形成过大的 review 循环。新的订单切分保持纵向价值：C1 能实际记录和修改草稿，C2 能处理单条生命周期，C3 增加多单效率并完成总验收；每个切片都可独立运行和回归。把 shared schema、CMS route 或 FE scaffold 单独拆 PR 仍没有用户价值，因此不采用按技术层拆分。

**Alternatives considered**:

- 单独 scaffold PR：没有用户价值，拒绝。
- 一个 M1 大 PR：review 和回归范围过大，拒绝。
- 一个完整 M1-C PR：仍会同时审 profile、持久化边界、状态机、批量与整页交互，已根据 #146 经验拒绝。
- 按 shared/CMS/BE/FE 技术层拆 PR：中间提交不可独立使用，拒绝。
- 堆叠 PR：Codex 自动 review 与仓库 rebase merge 约束使其收益有限，拒绝。

## 2. Brownfield 复用方式

**Decision**: 参考旧 `apps/kith-inn-be`/`apps/kith-inn-fe` 的 Hono、Taro、Web Crypto、微信交换和测试配置，但 v1 不 import、修改或依赖旧业务 package/source。

**Rationale**: 工程模式已经在本仓库验证，可降低探索成本；v1 数据契约和状态语义不同，直接复用旧业务代码会重新耦合两个产品。

**Alternatives considered**:

- 抽通用 auth/CMS client package：目前只有两个产品且 claims/header 不同，属于过早抽象。
- 复制完整旧 app：会带入 agent、旧订单模型和 UI 依赖，拒绝；只复制最少配置模式。

## 3. Operator 登录 bootstrap 与多 seller 选择

**Decision**: 微信 code 只在 v1 BE 换 openid；BE 用独立 v1 service secret 调 CMS membership lookup。单 membership 直接签发 operator JWT；多 membership 返回 5 分钟选择 token 和最小 seller 列表，用户选择后 BE 重新查询 membership 仍 active，再签发 7 天 operator JWT。

选择 token 使用 `kind=operator-selection`，包含允许的 `operatorId + sellerId` 坐标；operator JWT 使用 `kind=operator`，包含单一 `operatorId`、`sellerId`、`role=operator`、`iat`、`exp`。验证必须检查 token kind，避免两类 token 混用。

**Rationale**: 登录前还没有 tenant JWT，必须有窄 service-auth bootstrap；短期签名 token 避免服务端 session store，又能防止客户端伪造 seller。选择时重查 membership 满足“登录后停用即失效”的边界。

**Alternatives considered**:

- 返回 openid 给 FE 再选择：泄露不必要身份键，拒绝。
- 服务端内存保存待选状态：多实例/重启不稳定，且没有必要。
- 把全部 seller 写进长期 operator JWT：一次会话不再是单 seller，拒绝。

## 4. Dev login

**Decision**: H5 提供 seeded openid 的 dev login，但必须同时满足非 production 和 `KITH_INN_V1_ALLOW_DEV_LOGIN=1`；weapp 微信登录失败时不得自动降级 dev login。生产构建/运行返回 404。

**Rationale**: H5 自动化无法调用真实 `wx.login`，需要可验证入口；双重开关和不自动 fallback 防止把开发捷径变成生产绕过。

**Alternatives considered**:

- 没有 dev login：H5 E2E 只能 mock，无法证明 BE/CMS 纵向链路。
- 非 production 自动开放：本地网络或预览环境容易误暴露，拒绝。

## 5. JWT 与共享 CMS 身份边界

**Decision**: 在 `@cfp/kith-inn-v1-shared` 放置 claims schema 和最小 Web Crypto HS256 issue/verify helper，供 v1 BE/CMS 共用；使用独立 `KITH_INN_V1_JWT_SECRET`、`x-kith-inn-v1-operator` 和 `KITH_INN_V1_INTERNAL_TOKEN`，不复用旧 `JWT_SECRET`、header 或 `CMS_INTERNAL_TOKEN`。

CMS 每次 seller-scoped 请求除验证签名/过期/kind 外，还按 `operatorId + sellerId + active=true` 重查 membership，并确认 seller 仍为 active；请求体中出现 seller 字段一律返回 422。

**Rationale**: M0 明确 Admin、旧产品身份和 v1 产品身份分离；membership 重查使停用立即生效。shared 已是 v1 FE/BE/CMS 契约承载点，不需第三方 JWT 库或复制 verifier。

**Alternatives considered**:

- 复用旧 JWT secret/helper：身份混用风险，拒绝。
- 只依赖 7 天 token 过期：operator 被停用后仍可操作，违反规格。

## 6. CMS persistence boundary

**Decision**: 所有新 route 使用 `/api/internal/kiv1/*`。登录 lookup 只接受 service token；其他 route 只接受 v1 operator JWT。CMS 负责 token/membership、seller ownership、relationship ownership、输入 schema 和字段白名单；菜单选择、导入冲突策略、订单状态机留在 BE。

**Rationale**: CMS 使用 `overrideAccess` 时必须自己守住 seller；同时不应成为第二个业务服务。独立命名空间可回归断言旧 routes 不变。

**Alternatives considered**:

- 直接开放 Payload REST 给 BE：无法从产品 JWT 推导 seller 且 access 模型不匹配，拒绝。
- 把状态机放 CMS route：会跨层复制业务规则，拒绝。

## 7. 数据模型与 migration

**Decision**: M1 不修改七个 collection。菜品、菜单快照、profile、order 单价/顾客快照和三状态轴均由 M0 字段表达。继续使用 push 仅限本地/CI/体验验证；不得在 M4 migration baseline 前写入需长期保留的真实订单。

**Rationale**: 无新增业务事实需要持久化，新增 collection 或冗余字段没有收益。M4 已明确负责整个 shared CMS 的 baseline，不能只给 v1 建一套 migration。

**Alternatives considered**:

- 新增 menu plan/order item/fulfillment：M0 已明确拒绝，当前套餐份数和单次履约不需要。
- M1 单独迁移 v1：会让同一 CMS 同时存在两种 schema 管理方式，拒绝。

## 8. 菜品文本导入

**Decision**: BE 使用纯函数按行和空白/常见分隔符解析，预览不写库。commit 重新解析原文本并重新查询当前 seller 重名：默认 skip，显式 overwrite 才 patch；最多 50 行，逐行串行写 CMS 并返回 created/overwritten/skipped/failed。

**Rationale**: 无 server-side preview state、上传文件或事务需求；重新解析可防前端篡改，数据库 unique 处理并发。逐行结果允许安全重试，50 次以内内部调用符合当前规模。

**Alternatives considered**:

- preview token/服务端缓存：引入状态和过期清理，拒绝。
- CMS bulk transaction route：把冲突业务策略下沉 CMS，且当前量级不需要。
- AI 解析：不确定、不可预览复现，明确非目标。

## 9. 菜单生成与放宽顺序

**Decision**: 生成器是 BE 内纯函数，输入当前 seller 启用菜品、目标餐次、目标日前 7 日历史和本批已生成餐次；随机源可注入以便测试。硬约束始终是 2 meat、2 veg、1 soup、单餐菜不重复；软偏好按“同周同菜、同日同主料、7 日同菜、7 日同主料”从高到低做字典序最小化，并把无法满足的偏好返回 UI。

**Rationale**: 先硬后软能在足量时满足避重，在有限菜品池时仍给出可解释结果；字典序评分比多轮回退分支更短、更可测试。注入随机源只用于同分候选，比固定全局 seed 简单；历史从 meal slot 快照查询，无需冗余 useCount。

**Alternatives considered**:

- 新增通用 menu-core package：只有 v1 使用，过早抽象。
- 存 lastUsedAt/useCount：与 M0 数据模型决策冲突，且历史快照已足够。

## 10. 订单写入与状态机

**Decision**: `POST /merchant/orders` 遇到同 profile+slot 返回 409 和现有最小摘要；活动订单由显式 PATCH 更新，canceled 订单由独立 resubmit action 重置 draft。confirm/cancel/payment/delivery 均为明确 action；只有 confirmed 可切付款/送达，canceled 普通操作全拒绝。BE 决策后让 CMS patch 白名单字段。

新 profile 先创建再建 order；若 order 失败，profile 作为可复用资料保留，不做跨 HTTP 事务。订单列表的汇总和纯文本清单由 BE/FE 纯函数从当前响应派生，不新增持久化字段。

**Rationale**: action endpoint 让状态迁移可审计、可测试，避免通用 PATCH 绕过。M0 unique 已消除并发重复；保留已建 profile 不会产生不一致业务数据。

**Alternatives considered**:

- 通用 PATCH 接受任意状态：容易跳转非法状态，拒绝。
- 分布式事务/补偿框架：单商家低量级不值得；profile 本身是有效独立实体。

## 11. FE 依赖与 UI

**Decision**: 使用 Taro 4.2 + React 18、Taro 原生 `View/Text/Input/Button/Picker` 和普通 CSS；不引入 NutUI、Tailwind 或新状态管理库。session 使用 Taro storage；页面逻辑抽为纯函数，页面/components 由 H5 E2E 覆盖。

**Rationale**: M1 只有四个商家页面，平台原生组件足够；比复制旧 FE 的完整 UI 栈更少依赖、更少构建特殊配置。

**Alternatives considered**:

- 复制旧 NutUI/Tailwind 配置：能工作但带来大量非必要依赖和编译配置。
- 新 UI/domain package：当前无跨产品复用需求。

## 12. 验证与端口

**Decision**: v1 BE 默认 3311，v1 H5 dev server 10087，CMS 保持 3304，旧 BE 3310 不变。每个 PR 运行 shared/BE/FE/CMS 窄测试、PostgreSQL tenant 集成、H5 关键流和 `pnpm verify`；weapp 只做构建与真机 smoke。

**Rationale**: 固定无碰撞端口便于 Playwright 同时启动三层。纯逻辑 100% coverage、真实 H5 纵向流和 PostgreSQL owner 测试分别覆盖规则、装配和实际边界。

**Alternatives considered**:

- 所有 e2e mock API：无法证明 v1 JWT/CMS seller 边界。
- 自动化微信 code2Session：需要真实 AppID/code，CI 不稳定；使用显式 dev login，weapp 人工 smoke。
