# 本地 H5 MVP 集成与评审核查

日期：2026-09-22。集成入口：[PR #376](https://github.com/code-for-people-2026/cfp-mono/pull/376)。用户已授权合并当前本地试用实现，并获知共享配置变更会触发官网发布及其停服备份步骤。本记录不代表街坊味上线或微信真机验收。

## 合并范围

- `packages/kith-inn-contracts`：输入、输出及错误契约。
- `apps/kith-inn-api`：原生 HTTP API、微信会话实现、PostgreSQL 17 五表迁移、菜品池、周菜单生成/保存/回看及幂等写入。
- `apps/kith-inn-miniapp`：同一套 Taro 源码的 H5/weapp 构建、菜池、周菜单、历史、单餐做汤调整和分字段复制接龙文字。
- 对应规格、用户故事、交接和测试。独立运维 PR #368、生产配置、用户测试数据和临时分享代理不在此范围。

以 `main=7bb984d`、界面交付基线 `cee75be` 核对：#361、#364、#367、#369～#375 的 head 均为集成分支祖先。#362 的 `cf839a8→daa1f6c`、#363 的 `d5be6be→f4ae42f`、#365 的 `d0fb510→a724fe0` 及 `73b4a74→b235b00` patch-id 等价；#365 剩余历史文档内容已被后续记录吸收。#366 的客户端基础直接包含，`ee9024d` 的 API 源站注入已由 `10b56b5` 带入。未发现遗漏的前序有效实现。

仓库只允许 squash；采用 #376 一次集成，成功后将上述 14 个已覆盖旧 PR 关闭并链接到集成结果。#368 继续独立保留。最终合并 SHA、CI 和时间以 GitHub 事实为准；#357～#360 的产品/微信验收状态不因合并自动完成。

## Codex review 处理

| 反馈 | 当前处理与证据 |
| --- | --- |
| #372/#374：全 14 餐关闭仍因菜池不足失败 | 已修复：只有存在启用餐次才拒绝 shortages。回归证明全关闭+空池可生成合法空餐快照，重新开启一餐仍返回 422，非法输入仍返回 400。 |
| #370/#372/#374：旧回执只在 UUID 重用时清理 | 已修复：复用已有账号锁事务，在每次幂等写入入口按 `merchant_id` 和 `expires_at <= now` 清理，不依赖旧 UUID 重用。真实 PG 验证新键触发清理、有效回执仍重放、业务失败回滚清理。闲置账号不后台清扫，线上保留/删除承诺仍由 #360 落实。 |
| #366/#367/#369/#373/#376：TARO_APP_ID 未注入 | 复核为误报：安装的 `@tarojs/cli@4.2.0` 的 `generateProjectConfig` 原生执行 `process.env.TARO_APP_ID || origProjectConfig.appid`。在 `cee75be` 实际带测试 AppID 构建，并断言生成值匹配、`miniprogramRoot === './'`；无需自建覆盖代码。真实上传前的 AppID 核验继续归 #360。 |
| #371：菜池绕过共享客户端 | 已在最新实现修复：菜池页面通过 `getKithInnClient()` 取得客户端，不再创建页面私有客户端；保留跨导航的未知写入状态。 |
| #361：错误响应缺少操作所需 details | 后续共享契约/OpenAPI 已补条件字段和对应正反例，包含版本冲突 currentVersion、重名 names；沿用契约测试。 |
| #361/#362/#365：交接仍声称没有代码/Issue | 当前 handoff、quickstart、plan、tasks 已更新到集成范围；最初接手说明明确标记为历史，不要求再次复制机器上的未提交规格。 |
| #374：分域 H5 缺少 CORS | 部署前待办，不在本次引入任意来源 CORS。当前实际 H5 通过同源代理访问 API；quickstart 明确这一前提。#360 部署时保持同源，或单独验证精确允许的 Origin/OPTIONS。 |
| #369：代理后的登录限流共享 IP | 部署前待办：当前 API 不信任伪造的转发头；上线反向代理前需在 #360 配置可信代理地址识别或边缘按真实来源限流，并验证一个来源不能阻断其他来源。未声称此项已修复。 |

## 已执行验证

- API 修复原始提交 `4aad797`：Node 22、UTC、全新临时 PostgreSQL 17 独立 `_test` 库，95 个测试 / 9 个文件通过；API lint、typecheck、diff 检查通过。验证容器已移除，未连接用户 54325 测试库。跨账号范围有单元回归；当前单账号数据库约束下未构造真实多租户数据。
- 原界面 `cee75be`：55 个前端单测，菜单 H5 34 项、菜池 H5 8 项；最后无姓名示例调整后重新通过文字测试 13 项、lint/typecheck 及双构建。对应 CI 已成功，后续集成提交须再通过自身 CI。
- AppID 机制复验：Node 24.13.0，本机安装的 Taro 4.2.0，独立工作树内执行下列命令成功；这是编译产物证据，不是真实微信账户测试。

```sh
TARO_APP_ID=wx0000000000000000 pnpm --filter @cfp/kith-inn-miniapp build:weapp
node -e 'const assert=require("node:assert/strict"); const c=require("./apps/kith-inn-miniapp/dist/project.config.json"); assert.equal(c.appid,"wx0000000000000000"); assert.equal(c.miniprogramRoot,"./")'
```

最终集成提交的根 `pnpm verify`、受影响 E2E 与构建结果以 PR #376 的对应 SHA 检查为准，不把旧提交结果记到新提交。微信登录、真实剪贴板/接龙、线上 API/数据库、恢复与退出删除演练仍待 #360。
