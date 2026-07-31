# Weekly Menu 迁移与架构决策

> 状态：#312 定稿候选
>
> 日期：2026-07-31
>
> 唯一目标仓库：`code-for-people-2026/cfp-mono`

本文收口 `miyin-derick/weekly-menu` 的有效资产，并为 #313～#319 固定目录、依赖、数据与部署所有权。旧仓库和已关闭 PR #14 只作证据源，不再接收提交，也不在本 Issue 删除。

## 1. 规格档位判断

Weekly Menu 横跨小程序、共享包、后端、数据库和部署，按历史 CFP 宪法属于需要完整架构规划的跨切面功能。但最新 `main` 已通过 PR #309 删除 Spec Kit、历史 `apps/cms` 与 Kith 资产；#312 不恢复已经退役的工具链。本文以一份可审查的决策记录覆盖同等必要内容，后续仍坚持一个 Issue、一个分支、一个 PR。

## 2. brownfield 证据

- `apps/community-cooking` 的首个迁移提交已经声明来源为同一套 `sunmer-home/apps/weekly-menu`，并同时落地 Taro 页面骨架、`@cfp/menu-core` 与菜谱集合。
- `apps/community-cooking` 已通过 `workspace:*` 使用 `@cfp/menu-core`，并封装 `apps/website` Payload `recipes` 的 URL 构造器；菜单页仍使用占位数据，尚未发起真实请求。
- `apps/website` 是当前唯一生产部署目标；它拥有 Payload `website` schema、`recipes` migration、seed、`/api/health` 与 `/api/ready`。
- 2026-07-31 对 website canonical HTTPS 的只读核验显示 `big-meat`、`small-meat`、`vegetable` 三个 active 分类均非空；该数据不是由 Weekly Menu seed 创建，发布门禁只检查每类 `> 0`，不锁定数量。
- PR #309 已删除历史 `apps/cms`、Kith packages、schema 与部署资产。它们不是当前可复用运行时。
- 旧独立仓库尚未实现可运行的小程序或业务 API；旧 PR #14 仅提供健康检查与关闭流程的实现思路。

## 3. 四项架构结论

### 3.1 产品与唯一 app 路径

Weekly Menu 是 `apps/community-cooking` 内的个人一周菜单、历史与本周菜品勾选清单能力，不是第二个小程序。

- 保留 `apps/community-cooking` 与 `@cfp/community-cooking` 名称，避免无功能收益的目录、包名和微信工程重命名。
- #317 直接扩展现有页面、组件与请求层。
- 不创建 `apps/weekly-menu-miniapp`，也不恢复已归档 `apps/miniapp-fe`。
- Taro 的 H5 输出继续用于自动化验证；生产 MVP 交付物仍是微信小程序包，不新增 H5 常驻容器。

### 3.2 菜谱内容与 CMS

`apps/website` Payload 是官网私有 CMS，不是“共享 CMS”或公共基础设施；Weekly Menu 只消费它已经存在的一项公开只读能力，不恢复独立 CMS runtime。

- `/admin`、Payload 配置、website 数据库、migration/seed、写接口和管理权限全部由 website 私有所有；Weekly Menu 不修改或放宽任何访问权限。
- 唯一允许的复用是 `weekly-menu-be` 以服务端消费者身份，通过 HTTP 调用既有匿名只读 `GET /api/recipes`；它不连接 website 数据库，也不导入 `apps/website` 源码。
- 最终小程序只调用 Weekly Menu API，绝不直连 Payload。Weekly Menu API 只返回 Happy Path 所需的最小 DTO，不透传 Payload collection、分页或管理模型。
- 当前只有一个真实 Payload host，不抽取 `cms-common` 或 Payload plugin；出现第二个真实 host/消费者后再评估。
- 不新增 CMS internal route/token。未来若需要写 CMS，必须另开 Issue，并重新取得架构与安全授权。

`recipes` 已是 website 拥有的内容，不随 Weekly Menu 删除。#318 每次发布前必须经 canonical `GET /api/recipes` 验证三个 active 分类均非空；任一分类为空就停止发布。Weekly Menu 不执行 website seed 或数据修复。若既有记录被停用或错分，只能由 website 所有者经现有 `/admin` 纠正；现有幂等 seed 只会补充真正缺失的菜名，不能重新启用或纠正分类，也只能由 website 所有者在独立授权下使用。若未来要改变 recipes 归属，应由 website 的独立 Issue 和 migration 决定。

### 3.3 源码共享与运行/数据库隔离

```text
apps/community-cooking
  └─ workspace:* -> packages/weekly-menu-shared

apps/weekly-menu-be
  ├─ workspace:* -> packages/weekly-menu-shared
  ├─ workspace:* -> packages/menu-core
  ├─ HTTPS ------> apps/website /api/recipes（只读）
  └─ SQL --------> Weekly Menu 专用数据库

apps/website
  └─ Payload ----> 既有 CFP 数据库的 website schema
```

规则：

- `packages/menu-core` 只负责生成与换菜算法，是唯一事实源。
- `packages/weekly-menu-shared` 只放 DTO、验证、错误码和纯领域规则，不依赖 Taro、HTTP、Payload、微信 SDK 或数据库。
- 三个 app 不互相导入 app 源码；跨运行时只使用 HTTPS 契约。
- `apps/weekly-menu-be` 的独立运行时确有必要：微信密钥不能进入客户端，个人会话和计划不能写入 website，Weekly Menu 发布也不能替换官网容器。
- Weekly Menu 后端只持有自己的数据库连接；website 不连接 Weekly Menu 数据库。

### 3.4 常驻进程与所有权

Weekly Menu 新增一个常驻进程：`apps/weekly-menu-be`。现有 website 容器保持不变，原生小程序是构建产物。

| 能力 | 运行/数据所有者 | migration / seed 所有者 | 删除边界 |
| --- | --- | --- | --- |
| 菜谱内容 | `apps/website` / `website.recipes` | website 已提交 Payload migrations；现有受门禁 seed | 不随 Weekly Menu 删除 |
| 微信身份与会话 | `apps/weekly-menu-be` / Weekly Menu 专库 | `weekly-menu-be` migrations；无 seed | 可按 `weekly_menu_*` 精确删除 |
| 菜单计划与计划项 | `apps/weekly-menu-be` / Weekly Menu 专库 | `weekly-menu-be` migrations；无 seed | 可按 `weekly_menu_*` 精确删除 |
| 本周菜品勾选清单 | 服务端响应仅含 confirmed plan 的去重菜名；`checked` 状态仅客户端本地，不进入业务库 | 无独立表、无 seed | 随计划或本地缓存消失 |

业务表统一使用 `weekly_menu_` 前缀，至少包括 `weekly_menu_identities`、`weekly_menu_sessions`、`weekly_menu_plans` 和 `weekly_menu_plan_items`。confirmed 计划不可修改或删除；复制历史会创建新的 draft。

`study_weekly_menu` 选作 #318 的候选生产业务库，但在实际发布授权前仍保持闲置，不连接、不写入。`study_platform` 不再需要，进入 #319 的精确删除候选；任何删除仍需用户单独确认。

当前 recipes 与计划都没有 ingredients/quantity，因此 MVP 不提供食材购物清单。真正的食材购物清单明确 deferred：只有 website recipes 的所有者通过独立 Issue 增加结构化食材/用量，并重新完成架构与安全评审后才能实施；Weekly Menu 不得自行扩展 website 私有 schema。

## 4. 部署契约

以下名称由后续 Issue 实现；#312 不修改部署代码或云资源。

| 项目 | 最小契约 |
| --- | --- |
| 镜像与容器 | `cfp-weekly-menu-be`；只绑定 `127.0.0.1:3304` |
| 健康检查 | `GET /api/health` 检查进程；`GET /api/ready` 检查 Weekly Menu 专库与三个 active recipes 分类各 `> 0` |
| 公网入口 | `https://weekly-menu-api.codeforpeople.cn`，由独立 Nginx HTTPS 路由转发；安全组不开放 `3304` |
| 发布目录 | `WEEKLY_MENU_REMOTE_ROOT=${HOME}/cfp-weekly-menu`；必须与 `${HOME}/cfp-mono` 分离且不得位于其子目录 |
| migration | `pnpm --filter @cfp/weekly-menu-be db:migrate`，只操作 Weekly Menu 专库 |
| smoke | health、ready、受保护 API 无凭据返回 `401`，并确认 website 仍可用 |

运行时只使用 Weekly Menu 专用数据库账号和连接串，不连接 website 数据库。环境变量名为 `WEEKLY_MENU_DATABASE_URL`、`WEEKLY_MENU_RECIPES_BASE_URL`、`WEEKLY_MENU_WECHAT_APP_ID`、`WEEKLY_MENU_WECHAT_APP_SECRET`、`WEEKLY_MENU_REMOTE_ROOT`、`PORT`、`RELEASE_SHA`；小程序另使用构建时变量 `TARO_APP_WEEKLY_MENU_API_BASE_URL`。真实值只安全注入运行环境，不进入仓库、Issue、PR 或日志；AppSecret 永远只在服务端。

`apps/community-cooking/project.config.json` 的 `touristappid` 只用于本地骨架。#317 使用被精确忽略且未跟踪的 `project.private.config.json` 配置与后端相同的真实 AppID；用户登录微信开发者工具后手工上传体验版并完成真机验证，不引入上传私钥或自动上传 CI。

最小发布流程允许短暂停机：

1. preflight 检查镜像、配置、website ready 与三个 recipes 分类；缺失真实微信凭据时不得宣称可供真机联调；人工确认当前没有 website 生产发布运行，并在本次 Weekly Menu 短暂停机窗口内不触发 website 发布。
2. 只停止旧 `weekly-menu-be`；首次发布没有旧容器时跳过。不得停止、替换或恢复 website。
3. 为 Weekly Menu 专库创建并校验数据库级逻辑备份。
4. 执行一次 `db:migrate`。
5. 在 `127.0.0.1:3304` 启动新容器。
6. 验证 health、ready 与无凭据 `401`。
7. 配置或复验 Weekly Menu 专属 Nginx、DNS、TLS，并运行公网 smoke。
8. 人工确认发布完成；#317 随后配置微信合法 request 域名并完成体验版与真机 Happy Path。

preflight 失败时直接退出并保持当前运行态；成功停止旧 BE 后任一步失败，则保持 Weekly Menu 停止，保留日志和逻辑备份供人工判断，绝不操作 website。兼容变更可由人工恢复上一不可变镜像；不兼容的数据恢复必须再次人工确认，不做自动回滚。

共享 RDS 禁止任何 target 原地恢复整个实例；实例级恢复只能先恢复到隔离实例或目标，再提取所属数据库。

非 MVP、本期不做：五态 marker、point-of-no-return、全 virtual-host 方法门禁、首次/后续双状态机、`flock`/复杂 rollout、自动恢复矩阵、全局 RDS 恢复编排、零停机和自动回滚；未来只有出现真实需求时才重新评估。

## 5. 资产处置清单

| 分类 | 资产 | 处理 |
| --- | --- | --- |
| 直接复用 | `apps/community-cooking` | 继续实现 Weekly Menu UI，不复制 app |
| 直接复用 | `packages/menu-core` | 保持算法唯一事实源 |
| 直接复用 | website 已有的匿名只读 `GET /api/recipes` | website 私有所有权不变；BE 只作服务端消费者 |
| 迁移 | 生成、替换、保存、确认、历史、复制、删除、本周菜品勾选清单目标 | 进入 #313、#316、#317 的契约与验收 |
| 迁移 | API 错误格式、所有权反例、健康检查、优雅关闭测试思路 | 按 CFP 当前依赖重写 |
| 迁移 | 脱敏 ECS/RDS 审计与四向账号隔离结论 | 只作 #318/#319 验收证据，不记录地址或资源 ID |
| 重写 | 后端、微信会话和业务数据库访问 | 新建最小 `apps/weekly-menu-be`，不复制旧实现 |
| 重写 | migration、部署、smoke、恢复与删除资产 | 使用独立 Weekly Menu 目录与短暂停机发布，不复用 website 发布状态 |
| 舍弃 | 独立 `platform-backend` 与通用 CMSAdmins/Applications/AppConfigs/ContentItems 设想 | 当前无第二个真实需求 |
| 舍弃 | 第二套 monorepo、重复 CI、第二个小程序、重复生成器 | CFP 已有对应能力 |
| 舍弃 | 旧 PR #14 的直接 `pg` pool、配置和容器结构 | 仅保留 liveness/readiness、脱敏错误、依赖注入 probe、SIGTERM 测试思路 |
| 舍弃 | 旧账号、菜单历史、旧 CMS 元数据 | 不迁移；只使用可重复生成的菜谱内容 |

## 6. Issue 与 PR 切片

| 顺序 | CFP Issue | 单一交付物 |
| --- | --- | --- |
| 1 | #312 | 本决策、旧资产映射与删除前清单 |
| 2 | #313 | `packages/weekly-menu-shared` 的 DTO、验证与纯规则 |
| 3 | #314 | `apps/weekly-menu-be` 内的数据访问、提交 migration 与持久化测试 |
| 4 | #315 | 后端组合根、微信登录/会话、health/readiness 与优雅关闭 |
| 5 | #316 | `/api/v1/weekly-menu/*` Happy Path 与安全反例 |
| 6 | #318 | 独立 affected target、镜像、Compose、发布/smoke/回滚资产；云端执行由基础设施会话负责 |
| 7 | #317 | 扩展 `apps/community-cooking` 的页面、Mock adapter 与真实 API adapter；完成微信侧生产验收 |
| 8 | #319 | 恢复演练、观测、精确删除和旧仓库删除前核对 |

#317 的页面与 Mock adapter 可在 #313 后提前开发，但真实联调等待 #315/#316，生产验收与 Issue/PR 关闭等待 #318 的 HTTPS 服务健康。每个 Issue 开始前先检查已有分支与 PR；不把相邻 Issue 偷渡进当前 PR。

## 7. 旧仓库映射

| 旧记录 | CFP 去向 |
| --- | --- |
| #1、#4、PR #13 | #318、#319 的脱敏环境与隔离验收证据 |
| #2 | #312；独立仓库工程基线不迁移 |
| #3 | #318 的“不新增公网规则”边界 |
| #5、已关闭 PR #14 | #315 的健康检查与关闭测试思路 |
| #6 | #314；旧共享 CMS 设计舍弃 |
| #7 | #313、#314、#316 |
| #8 | #315 |
| #9 | #316 |
| #10 | #318 |
| #11 | #317 |
| #12 | #319 |

## 8. 删除前门禁

删除 `miyin-derick/weekly-menu` 前必须全部满足：

- #313～#319 的目标代码、验证与运行手册已有 CFP 唯一入口。
- 旧 PR #14 的有效测试思路已迁移或明确舍弃，且从未合并到旧 main。
- 脱敏基础设施结论已保留；没有密码、连接串、IP 或云资源 ID 被复制。
- 旧 Issue 与 PR 均可追溯到上表的 CFP 入口。
- #319 已解析仓库与闲置数据库的精确目标，并再次取得用户确认。

在门禁完成前，不删除旧仓库、`study_platform` 或 `study_weekly_menu`，也不向旧仓库继续提交。
