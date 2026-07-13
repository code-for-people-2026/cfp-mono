# 功能规格：CMS 项目级 Seed 隔离

**Feature Branch**: `codex/014-cms-seed-isolation`

**Created**: 2026-07-13

**Status**: Draft

**Input**: GitHub #164「隔离各项目的 seed 与开发重置范围」

## 用户场景与测试

### User Story 1 - 安全重建 kith-inn 开发数据（Priority: P1）

作为 kith-inn 开发者，我只运行明确属于 kith-inn 的 seed 或开发重置，确保共享 CMS 中的 kiv1 数据完全不变。

**Independent Test**: 预置 kiv1 哨兵数据，分别运行 kith-inn seed 与 reset；哨兵的内容、数量和标识不变，且操作记录中没有任何 kiv1 collection。

**Acceptance Scenarios**:

1. **Given** CMS 同时存在 kiv1 哨兵数据，**When** 运行 kith-inn seed，**Then** 只访问 kith-inn collections。
2. **Given** CMS 同时存在 kiv1 哨兵数据，**When** 运行 kith-inn 开发重置，**Then** 只清理并重建 kith-inn 数据，哨兵完全不变。

### User Story 2 - 安全重建 kiv1 开发数据（Priority: P1）

作为 kiv1 开发者，我只运行明确属于 kiv1 的 seed 或开发重置，确保共享 CMS 中的 kith-inn 数据完全不变。

**Independent Test**: 预置 kith-inn 哨兵数据，分别运行 kiv1 seed 与 reset；哨兵的内容、数量和标识不变，且操作记录中没有任何 kith-inn collection。

**Acceptance Scenarios**:

1. **Given** CMS 同时存在 kith-inn 哨兵数据，**When** 运行 kiv1 seed，**Then** 只访问 kiv1 collections。
2. **Given** CMS 同时存在 kith-inn 哨兵数据，**When** 运行 kiv1 开发重置，**Then** 只清理并重建 kiv1 数据，哨兵完全不变。

### User Story 3 - 不误用破坏性入口（Priority: P1）

作为开发者，我只看到带项目名的命令，并且开发重置继续受显式开关、本地数据库与非生产环境保护。

**Independent Test**: 命令清单只包含四个项目级入口；缺少开关、远程数据库或 production/staging/preview 环境均拒绝重置。

### Edge Cases

- 目标项目没有任何数据时，reset 仍能完成并重新 seed，不访问另一项目。
- seed 已经应用时保持幂等，不借机扫描另一项目。
- 未指定或指定未知项目时拒绝执行，不能退化成“全部项目”。

## Requirements

### Functional Requirements

- **FR-001**: kith-inn seed/reset MUST 只访问 kith-inn collections。
- **FR-002**: kiv1 seed/reset MUST 只访问 `kiv1_*` collections。
- **FR-003**: 两个方向 MUST 用真实 seed/reset 逻辑和另一项目哨兵数据验证内容、数量、标识与访问记录均不变。
- **FR-004**: 系统 MUST 删除同时编排两个项目的 `applyAllSeeds` / `resetAllSeedData` 行为。
- **FR-005**: 开发者 MUST 只能通过 `seed:kith-inn`、`seed:kith-inn:reset:dev`、`seed:kiv1`、`seed:kiv1:reset:dev` 四个明确入口操作。
- **FR-006**: 系统 MUST NOT 提供无项目名的 seed/reset 或跨项目 reset 入口。
- **FR-007**: 破坏性 reset MUST 保留显式环境变量、本地数据库和非 production/staging/preview 三层保护。
- **FR-008**: 本功能 MUST NOT 改变任何业务 collection/schema、API 契约或非 seed 业务逻辑。
- **FR-009**: 开发文档 MUST 说明项目级命令、安全开关和禁止跨项目重置的约束。

## Success Criteria

### Measurable Outcomes

- **SC-001**: 四种目标操作对另一项目数据的内容、数量和标识变化数均为 0。
- **SC-002**: 四种目标操作对另一项目数据的读、写、删除请求数均为 0。
- **SC-003**: 可用命令中项目级 seed/reset 入口为 4 个，含糊或跨项目入口为 0 个。
- **SC-004**: 缺少显式开关、远程数据库或受保护环境下的开发重置拒绝率为 100%。
- **SC-005**: 全仓质量门禁通过，业务 schema 与 API diff 为 0。

## Assumptions

- 继续复用现有 kith-inn 与 kiv1 fixture、幂等策略和本地数据库识别规则。
- 现有 `KITH_INN_ALLOW_DEV_SEED_RESET=1` 作为兼容的显式破坏性操作开关，本 issue 不扩展为环境变量重命名。
- 本功能按宪法采用轻量 spec，并在一个 PR 内交付同一条双向隔离不变量。
