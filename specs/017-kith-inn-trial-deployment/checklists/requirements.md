# Specification Quality Checklist: kith-inn 桃子体验版部署与真机发布

**Purpose**: 在进入技术规划前验证规格的完整性、清晰度和可验收性
**Created**: 2026-07-14
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] CHK001 需求聚焦于桃子白名单真实试用和发布价值，不把实现代码结构当作产品需求
- [x] CHK002 规格明确现有部署、镜像、前端 URL 与 secret 缺口，没有把待办描述成既成事实
- [x] CHK003 叙述可供产品、发布、运维、安全与工程维护者共同审阅
- [x] CHK004 所有必填章节均已完成，且不存在模板占位内容

## Requirement Completeness

- [x] CHK005 每条功能需求都有唯一标识，使用可验证的 MUST/MUST NOT 语义
- [x] CHK006 覆盖 CMS/BE/H5/小程序生产构建、共享 RDS `cms` schema、HTTPS 与 fail-closed 配置
- [x] CHK007 覆盖 Nginx/TLS、health/readiness、seed/迁移、smoke、上传、白名单、证据和回滚
- [x] CHK008 覆盖自动登录信任链与真机微信登录，且禁止公开 dev-login/smoke 后门
- [x] CHK009 明确 secret、真实 OpenID、上传私钥不得进入仓库、日志、PR、产物或截图
- [x] CHK010 明确主路径复用 ECS/RDS/ACR 与已备案 HTTPS 域名，云托管仅为未实施备选
- [x] CHK011 明确 H5 仅内部、桃子白名单边界，以及 #161、kith-inn-v1 和正式版等排除项

## Requirement Quality

- [x] CHK012 用户故事均有优先级、价值说明、独立测试和 Given/When/Then 验收场景
- [x] CHK013 成功标准包含可量化的构建、负例、幂等、smoke、上传、真机、回滚和影响隔离指标
- [x] CHK014 边界情况覆盖域名/TLS、部分初始化、重复 seed、依赖失效、上传错配和 schema 回滚
- [x] CHK015 关键实体覆盖候选版本、部署、身份绑定、自动 smoke 和真机证据生命周期
- [x] CHK016 规格不存在 `[NEEDS CLARIFICATION]`；外部域名前置失败时采用阻断而非未决分支

## Scope & Readiness

- [x] CHK017 所有 #158 验收项均可追踪到至少一条用户故事、功能需求和成功标准
- [x] CHK018 依赖与假设明确区分仓库内实现和仓库外的域名、微信后台、secret 配置
- [x] CHK019 每个失败路径都定义了阻断发布或回滚结果，没有静默降级到本地地址或开发登录
- [x] CHK020 规格已准备进入 research/plan，不需要向发起人追加澄清问题

## Notes

- 本清单只评估规格质量；实现验证步骤将在 `quickstart.md` 与 `tasks.md` 中展开。
