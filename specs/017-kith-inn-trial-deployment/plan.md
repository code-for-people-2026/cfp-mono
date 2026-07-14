# Implementation Plan: kith-inn 桃子体验版部署与真机发布

**Branch**: `017-kith-inn-trial-deployment` | **Date**: 2026-07-14 | **Spec**: [spec.md](./spec.md)

**Input**: GitHub issue #158 与本目录 `spec.md`

## Summary

在不改变 kith-inn 业务契约的前提下，把 CMS、BE、内部 H5 和微信小程序做成同一提交可追踪的生产候选：先收紧生产配置和数据库生命周期，再构建镜像、扩展现有 ECS/RDS/ACR 编排与 smoke，最后用独立工作流上传体验版并完成桃子白名单真机验收。请求主路径使用已备案主体下的 HTTPS 子域名；云托管仅为未实施备选。

## Technical Context

**Language/Version**: TypeScript 5.9、Node.js 22、Bash

**Primary Dependencies**: Next.js 16 + Payload 3.85、Hono 4、Taro 4.2、Docker Compose、Nginx、微信 `miniprogram-ci`

**Storage**: 现有共享 RDS PostgreSQL，CMS 固定使用 `cms` schema；发布证据存 GitHub Actions artifact/PR，不新增业务 collection

**Testing**: Vitest 100% coverage、Playwright H5 主链路、Payload PostgreSQL 集成测试、Docker build/Compose config、Nginx config、shell smoke、`pnpm verify`、真机手测

**Target Platform**: 阿里云 Linux ECS + ACR + RDS、HTTPS Web、微信小程序体验版；H5 仅内部入口

**Project Type**: Monorepo 内 CMS、Node API、Taro 多端 FE 与部署流水线

**Performance Goals**: 部署后自动 smoke 在 10 分钟内给出结论；应用失败演练 15 分钟内恢复上一可用版本或进入数据恢复流程

**Constraints**: 生产 FE 只接受显式 HTTPS API URL；不得泄露 secret/OpenID/私钥；不得公开 dev-login；每个实现 PR 默认人工 diff <400 行；不得影响 website 独立部署

**Scale/Scope**: 首轮仅桃子 1 名白名单 operator 与 1 个 seller；旧 kith-inn 全核心链路，不含 #161、kith-inn-v1、客户 UI、支付、正式版发布或新 AI

## Constitution Check

*GATE: Phase 0 前与 Phase 1 后均已复核。*

- **全套规格**：跨 CMS/BE/FE/部署、改变生产 schema 生命周期且预计多个 PR，已产出宪法要求的全部文档。
- **Monorepo 作用域**：只允许修改 `apps/cms`、`apps/kith-inn-be`、`apps/kith-inn-fe`、`packages/kith-inn-payload`、`deploy`、`.github/workflows`、`DEPLOYMENT.md`、`docs/kith-inn`、本规格目录，以及 PR8 为锁定 `miniprogram-ci` 依赖所需的根 `pnpm-lock.yaml`；不修改 `@cfp/kith-inn-v1-*` 业务 package。
- **Brownfield 事实**：现有生产只部署 website；CMS/BE 无 Dockerfile；H5/weapp 会回退 `192.168.31.120`；CMS `push:true` 且仅 Vercel 强校验；现有 seed 硬编码 dev OpenID 并按 seller 存在直接跳过；专用生产/上传 secrets 尚未配置。
- **可审查切片**：下表按配置契约→schema/seed→镜像→编排/smoke→部署→上传→真机验收排序，每片一个不变量并可独立验证。
- **完成定义**：每片包含窄验证与 `pnpm verify`，外发后逐条闭环 Codex review。
- **文档语言**：叙述主体为中文。无宪法例外；Phase 1 设计后仍为 PASS。

## PR 拆分计划

| PR | 单一目标 / 核心不变量 | 主要路径 | 独立验证 | 依赖 |
|----|----------------------|----------|----------|------|
| PR1 | 固化 #158 范围、部署决策、契约与依赖有序任务 | `specs/017-kith-inn-trial-deployment/**` | checklist、analyze、链接/格式检查 | 无 |
| PR2 | 生产 H5/weapp 只能使用显式合法 HTTPS BE URL，且无 dev-login 降级 | `apps/kith-inn-fe/**` | URL 负例单测、H5/weapp 生产构建、FE coverage | PR1 |
| PR3 | CMS/BE 缺少生产 DB、认证、微信或内部服务配置时在接流量前失败，并提供依赖 readiness | `apps/cms/**`、`apps/kith-inn-be/**` | env/route 单测、PostgreSQL readiness、两端 build | PR2 |
| PR4 | `cms` schema 只由提交的 migration 推进，桃子基线可幂等收敛且真实 OpenID 不入库外证据 | `apps/cms/payload.config.ts`、`apps/cms/migrations/**`、`apps/cms/seed/**`、`packages/kith-inn-payload/src/seed/**` | fresh/existing PG migration、seed 两次/中断恢复、零 reset | PR3 |
| PR5 | CMS、BE、H5 均生成同一提交可追踪、非 root、可启动的生产镜像 | 三个 app 的 `Dockerfile`、`next.config.ts`、`.dockerignore` | 逐镜像 build、非 root/health、secret 扫描 | PR4 |
| PR6 | Compose、Nginx、smoke 与中文 runbook 能部署和回滚完整 kith-inn 栈 | `deploy/**`、`DEPLOYMENT.md`、`docs/kith-inn/TECH-SPEC.md` | compose/nginx 静态检查、受控失败、health+认证+只读 smoke | PR5 |
| PR7 | 现有生产工作流只在 kith-inn 受影响且专用 secrets 完整时备份、迁移、部署、smoke/回滚，并持久化同 SHA 的通过凭据 | `.github/workflows/deploy-production.yml`、`deploy/**` | action lint、affected dry-run、缺 secret/备份/失败回滚演练 | PR6 |
| PR8 | 独立手动工作流只在查获并校验同一 main SHA 的持久化 smoke 通过凭据后可重复上传体验版 | `apps/kith-inn-fe/scripts/**`、`apps/kith-inn-fe/project.config.json`、根 `pnpm-lock.yaml`、`.github/workflows/release-kith-inn-weapp.yml` | uploader 单测、凭据/SHA 负例、dry-run、受控测试上传 | PR7 |
| PR9 | 实际云环境与桃子白名单真机完整通过，并留下脱敏证据 | `specs/017-kith-inn-trial-deployment/evidence/**`、必要 runbook 勘误 | 生产 smoke、版本关联、真机核心链路、回滚演练 | PR8 |

PR1 的全套 Spec Kit 产物预计处于 400–800 行：`spec/plan/tasks` 与 research/contracts/quickstart 必须在同一 PR 原子 review，拆开会使 analyze 缺少输入或留下互相失配的占位；本 PR 仍控制在 800 行以内。PR4 的 Payload baseline migration 属明确机器生成文件，不计人工 diff；若 seed 等人工 diff 预计超过 400 行，则把 seed 收敛拆为后续独立 PR，不与 migration 强行合并。其余每片默认人工 diff <400 行，超过时必须再按表内不变量拆分。

## Project Structure

### Documentation (this feature)

```text
specs/017-kith-inn-trial-deployment/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/release-contract.md
├── quickstart.md
├── tasks.md
├── checklists/requirements.md
└── evidence/                 # PR9 才创建，只含脱敏模板/结果
```

### Source Code (repository root)

```text
apps/cms/                     # Payload host、cms schema、migration/seed、镜像/readiness
apps/kith-inn-be/             # 生产 env、readiness、部署 smoke CLI、镜像
apps/kith-inn-fe/             # HTTPS URL 契约、H5/weapp 构建与体验版上传
packages/kith-inn-payload/    # 仅旧 kith-inn 的生产安全 seed 收敛
deploy/                       # Compose、Nginx、smoke、中文 runbook
.github/workflows/            # 生产部署与独立体验版上传
DEPLOYMENT.md                 # 长期部署总览
docs/kith-inn/TECH-SPEC.md    # 长期 kith-inn 部署决策同步
```

**Structure Decision**: 扩展既有 app 和生产流水线，不新增 workspace 或第二套部署系统；微信云托管不实施。共享 CMS migration 会反映当前聚合 schema，但不修改或 seed v1 业务 package。

## Complexity Tracking

无宪法违规或需保留的额外复杂度。
