# cfp-mono Spec Kit Constitution

## Core Principles

### I. Feature Specs Own Feature Work

Every new feature starts from a Spec Kit feature directory under `specs/`. Project-level documents under `docs/<project>/` are source material; they do not replace the feature `spec.md`, `plan.md`, and `tasks.md`.

### II. Monorepo Scope Is Explicit

Each feature spec MUST name its project and allowed source paths. A feature may only touch other monorepo areas when the plan explains the dependency and the task names the exact files.

### III. Brownfield Reality First

For existing projects, every implementation plan MUST record the current code facts before proposing changes: relevant routes, schemas, data tables, UI entrypoints, tests, and known gaps. Do not rewrite working architecture just to fit a new spec.

### IV. Smallest Shippable Slice

Specs and tasks should describe one independently testable slice. Prefer extending existing modules and contracts over adding new abstractions, dependencies, or parallel systems.

### V. Verification and Review Are Part of Done

Each feature plan MUST list the smallest relevant automated checks. PRs still follow the repository review rules in `AGENTS.md`.

## Monorepo Feature Rules

- Feature directories use the default Spec Kit shape: `specs/<NNN>-<project>-<feature>/`.
- The project name goes in the feature name, for example `001-kith-inn-chat-card-persistence`.
- Long-lived project docs live in `docs/<project>/`.
- Do not maintain separate PR-sized task ledgers outside Spec Kit feature directories.
- If a feature changes long-lived product behavior, architecture, or data model, update the relevant `docs/<project>/` document in the same PR.

## Governance

This constitution governs Spec Kit artifacts only. General repository engineering and PR rules remain in `AGENTS.md`. Changes to these principles require updating this file and noting the reason in the affected feature plan.

**Version**: 1.0.0 | **Ratified**: 2026-07-02 | **Last Amended**: 2026-07-02
