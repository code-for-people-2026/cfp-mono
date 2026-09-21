# 排菜 MVP 技术调研

调研日期：2026-09-20。范围是桃子的菜品池、周菜单、持久化与文字复制。本文记录技术选型依据，不表示产品已经实现、完成真机验证或部署。

## 1. 现有工程与选型

基线固定为 `origin/main` 的 `7bb984d6697b74b1f095cb6475be6cb0f4d0e264`，不把旧本地分支的废弃 Kith Inn 代码当成现行实现。

| 项目 | 核对结果 | 本次采用方式 |
| --- | --- | --- |
| 小程序 | `community-cooking` 使用 Taro 4.2.0、React 18.2.0 | 新建独立的排菜应用，沿用版本、构建配置和可访问组件模式；不为本次任务升级框架 |
| 后端 | `weekly-menu-be` 使用 Node 原生 HTTP、`pg ^8.20.0`、`tsx ^4.22.4`；容器为 Node 22 | 沿用简单 HTTP 服务与 SQL 迁移方式，不增加 ORM、消息队列或另一个后端框架 |
| 契约 | `weekly-menu-shared` 已使用 `zod ^4.4.3` | 新建排菜专用契约包；保留现有依赖系列，以锁文件确定实际安装版本 |
| 数据库 | CI 与运维文档采用 PostgreSQL 17 | 开发与验证沿用 PostgreSQL 17；新数据表、账号与迁移记录不混入社区做饭业务 |

依据：[小程序依赖](https://github.com/code-for-people-2026/cfp-mono/blob/7bb984d6697b74b1f095cb6475be6cb0f4d0e264/apps/community-cooking/package.json)、[后端依赖](https://github.com/code-for-people-2026/cfp-mono/blob/7bb984d6697b74b1f095cb6475be6cb0f4d0e264/apps/weekly-menu-be/package.json)、[后端容器](https://github.com/code-for-people-2026/cfp-mono/blob/7bb984d6697b74b1f095cb6475be6cb0f4d0e264/apps/weekly-menu-be/Dockerfile)、[共享包依赖](https://github.com/code-for-people-2026/cfp-mono/blob/7bb984d6697b74b1f095cb6475be6cb0f4d0e264/packages/weekly-menu-shared/package.json)、[CI 数据库](https://github.com/code-for-people-2026/cfp-mono/blob/7bb984d6697b74b1f095cb6475be6cb0f4d0e264/.github/workflows/ci.yml)。这些是仓库现状；选择沿用是本次工程判断。

现有前端客户端包含内存 Mock，不能证明真机登录和跨设备保存已经接通。现有共享包又依赖固定 `bigMeat/smallMeat/vegetable` 业务模型，不满足本次可变荤素汤结构，应只复用工程模式。[前端客户端](https://github.com/code-for-people-2026/cfp-mono/blob/7bb984d6697b74b1f095cb6475be6cb0f4d0e264/apps/community-cooking/src/lib/weekly-menu-client.ts)、[现有共享包](https://github.com/code-for-people-2026/cfp-mono/blob/7bb984d6697b74b1f095cb6475be6cb0f4d0e264/packages/weekly-menu-shared/src/index.ts)。

## 2. 单经营账号登录

微信提供的标准流程是：小程序通过 `wx.login` 取得短期 code，服务端调用 `code2Session` 换取 OpenID，然后签发自己的业务会话。code 有效期五分钟且只能使用一次；微信会话密钥不得下发客户端。Taro 4.x 提供对应的 `Taro.login`。[微信登录流程](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)、[wx.login](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html)、[Taro.login](https://docs.taro.zone/docs/apis/open-api/login/)。

本次选择：由部署配置限定桃子的 OpenID，服务端验证成功后才建立经营会话；不开放顾客或家人注册，不接受前端传入的 OpenID 作为身份凭据。同一微信账号在另一设备登录，仍归到同一个经营账号。AppSecret 只放服务端；本 MVP 不读取头像、昵称或手机号，也不使用 `session_key` 解密个人资料。

可以借鉴现有后端的 32 字节随机 token、SHA-256 摘要入库、过期和撤销检查。会话时长属于应用选择，不是微信承诺；微信 code、微信 `session_key` 和业务 token 是三个不同概念。每次业务请求仍须校验经营账号及资源归属。[现有认证实现](https://github.com/code-for-people-2026/cfp-mono/blob/7bb984d6697b74b1f095cb6475be6cb0f4d0e264/apps/weekly-menu-be/src/auth.ts)。

有一处不能照抄：现有实现把任何存在的 `errcode` 都当作失败，而微信官方成功响应示例含 `errcode: 0`。新适配器应接受成功码缺省或为 0 且 OpenID 合法的响应，拒绝非零错误码、缺失 OpenID、网络错误和超时；这些情况用模拟响应测试覆盖。登录重试重新获取 code，不能反复使用已消费的 code。[code2Session 当前官方页](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session.html)。

## 3. 保存和并发

PostgreSQL 的联合唯一约束适合保证一个经营账号在同一周只有一份当前菜单；`CHECK` 适合行内约束，不能取代跨表的菜品可用性校验。建议把周结构、14 个餐次和菜品快照作为一个有界的周菜单聚合保存，账户与周起始日单独建列并建立唯一约束。荤素汤数量、餐次唯一性、快照归属等仍由服务端验证。[PostgreSQL 17 约束](https://www.postgresql.org/docs/17/ddl-constraints.html)。

`jsonb` 可以承载固定结构的餐次与快照；更新仍会锁整行。对首版单经营账号、按周整体保存的模型，这是合理的简单方案，不必为每个菜品格子建立独立事务。不要依赖 JSON 对象键的顺序表示菜品顺序，顺序应由数组或明确的槽位序号表达。[PostgreSQL 17 JSON 类型](https://www.postgresql.org/docs/17/datatype-json.html)。

保存采用版本条件更新；受影响行数为 0 时返回冲突，让客户端保留本地调整并重新读取服务端版本。不要静默覆盖另一个设备的菜单。菜单写入与成功请求的幂等记录应同事务提交，使超时后重试不会重复生成数据；事务内所有 SQL 必须使用同一个 `pg` client。[PostgreSQL 事务](https://www.postgresql.org/docs/17/tutorial-transactions.html)、[事务隔离与并发更新](https://www.postgresql.org/docs/17/transaction-iso.html)、[node-postgres 事务](https://node-postgres.com/features/transactions)。具体字段、重试窗口和错误码由本规格的数据模型与契约统一规定。

采用菜名与分类快照是产品规则所需：菜品池更名或停用，不应悄悄改写已保存菜单。新增和替换的菜品须再次校验当前可用性；未改动的历史快照需要允许保留。这是本次领域设计判断，不是数据库自动提供的行为。

## 4. 菜单文字复制

`wx.setClipboardData` 和 `Taro.setClipboardData` 的能力是把字符串写入系统剪贴板，并区分成功与失败。它们没有“已发送到微信群”的业务回执。因此菜单分享直接由客户端把已保存菜单格式化为文字，再调用剪贴板 API；成功文案只能表示已复制。[微信剪贴板 API](https://developers.weixin.qq.com/miniprogram/dev/api/device/clipboard/wx.setClipboardData.html)、[Taro 剪贴板 API](https://docs.taro.zone/docs/apis/device/clipboard/setClipboardData)。

复制失败时保留可选择的完整文字供人工复制；不添加发布服务、公开顾客页、分享订单卡或自动发送。Taro 文档注明 H5 剪贴板为部分实现，因此浏览器演示通过不能代替微信真机复制验证。复制后菜单是否可修改按 PRD 的业务决定执行，不由剪贴板成功回调生成发布或锁定状态。

## 5. 契约和自动分类

OpenAPI 3.1 可以用一个 JSON 或 YAML 文件描述请求、响应、安全要求和错误；其 Schema Object 基于 JSON Schema Draft 2020-12。使用标准文件比只写接口清单更适合前后端独立核对。[OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)。

本次选择 OpenAPI 3.1 描述公开 HTTP 契约，后续实现使用仓库已有 Zod 4 做运行时边界校验。Zod 提供 JSON Schema 导出能力，但转换不代表所有自定义规则都能自动表达；周一日期、同餐不得重复、当前菜品可用性、版本冲突等必须有行为测试。开发时让契约示例同时经过服务端与客户端校验，避免手写三套互不一致的类型。[Zod JSON Schema](https://zod.dev/json-schema)、[OpenAPI Schema 验证说明](https://spec.openapis.org/oas/)。

菜名分类首版采用本地确定性建议规则加桃子逐项更正与明确确认；不引入外部 AI 服务、识别成功率承诺或新个人信息流转。这是根据当前只需荤、素、汤建议分类作出的工程取舍，最终类别始终以桃子确认值为准。

## 6. 验证与上线前事项

资料核对完成不等于环境可用。本次没有申请小程序 AppID、配置生产凭据、部署新服务、连接生产数据库或完成真机验证。

实现阶段验证真实 PostgreSQL 的唯一约束、重试和两设备冲突，以及服务重启后回读；发布前用桃子与非桃子的微信账号分别验证允许和拒绝路径，在真机完成重新登录、保存、退出重开、复制和失败恢复。

数据库备份应具有可执行恢复步骤；有备份文件不代表已经验证可恢复。可使用 PostgreSQL 的 dump/restore 能力，把恢复演练指向隔离数据库，检查菜单、菜品和归属后才记录通过。保留期限、备份频率、恢复时限与项目退出/删除承诺的执行办法属于上线安排，应在试用前确定并验证。[PostgreSQL 17 SQL Dump](https://www.postgresql.org/docs/17/backup-dump.html)。

来源核对说明：微信开发文档通过浏览工具访问失败后，直接从上述官方 HTTPS 地址读取正文核对；`code2Session` 使用已迁移后的官方页面，没有以第三方转载作为依据。其他外部资料均为相关项目的官方文档。
