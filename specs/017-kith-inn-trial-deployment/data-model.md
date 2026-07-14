# Data Model: kith-inn 桃子体验版交付记录

本功能不新增业务 collection；以下是发布流程的逻辑实体，存于 Actions metadata、镜像仓库、微信版本记录与本规格的脱敏 evidence，而不是 CMS 业务表。

## ReleaseCandidate

- `releaseSha`: 40 位 Git commit，主键。
- `cmsImageDigest`、`beImageDigest`、`h5ImageDigest`: 不可变镜像摘要。
- `weappBuildDigest`、`weappVersion`: 小程序构建摘要与上传版本。
- `configFingerprint`: 只含变量名/非敏感选项的摘要，不含值。
- `state`: `built | deployed | smoke_passed | uploaded | device_accepted | rejected | rolled_back`。
- 规则：所有产物必须来自同一 `releaseSha`；只有 `smoke_passed` 才可上传，只有 `uploaded` 才可真机验收。

## DeploymentRecord

- `releaseSha`、`environment`、`deployedAt`、`workflowRunUrl`。
- `schemaMigrationHead`: 已应用的最后 migration 标识。
- `publicBeHost`、`cmsHost`、`h5Host`: 仅主机名，不含凭据；H5 标记 internal。
- `previousReleaseSha`: 应用回滚点。
- `status`: `pending | healthy | failed | rolled_back`。
- 规则：readiness/smoke 未全绿不得为 `healthy`；失败必须关联诊断与回滚动作。

## TrialOperatorBinding

- `sellerId`: provisioning 输出并供 smoke 精确比对的非敏感 CMS 标识，不替代 OpenID secret。
- `operatorId`: CMS 内 operator 标识。
- `openidSource`: 固定为 `environment-secret`，不记录 OpenID值。
- `provisionedAt`、`provisionResult`: `created | reconciled | unchanged | failed`。
- 规则：同一 seller 只能有一个目标 owner binding；重复执行必须收敛，不得跨 seller 改写；smoke 中 operator 的 seller ID 必须与该值一致。

## SmokeEvidence

- `releaseSha`、`startedAt`、`durationMs`。
- `checks`: CMS liveness/readiness、BE liveness/readiness、operator lookup、短时 JWT、只读 offerings。
- `writeCount`: 必须为 `0`；`redactionPassed`: 必须为 `true`。
- `status`: `passed | failed`；失败只保存错误类别和关联日志，不保存 token/OpenID。

## DeviceAcceptanceEvidence

- `releaseSha`、`weappVersion`、`testedAt`、`testerRole: taozi`。
- `domainValidationEnabled`、`wxLoginPassed`。
- `steps`: 记单、确认订单、生成菜单、换菜、发布、标已付、批量送达的布尔结果。
- `finalStateSummary`: 脱敏数量/状态，不含顾客姓名、地址、OpenID或 token。
- `status`: `passed | failed`；全部规定步骤成功才可为 `passed`。

## Relationships & Transitions

`ReleaseCandidate` 1→1 `DeploymentRecord`，1→1 `SmokeEvidence`，0→1 `DeviceAcceptanceEvidence`；`TrialOperatorBinding` 属于目标环境，不随每次 release 重建。

```text
built → deployed → smoke_passed → uploaded → device_accepted
          └──────── failure ───────→ rejected → rolled_back
```

schema migration 成功但应用失败时，应用可回滚到兼容的 `previousReleaseSha`；不兼容时状态保持 `rejected`，按 runbook 前向修复或恢复快照，不伪造 `rolled_back`。
