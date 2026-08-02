# Domain Docs（领域文档）

本文说明工程 Skills 在探索代码库时应如何读取本仓库的领域文档。

## 探索代码前需要读取

- 根目录的 `CONTEXT-MAP.md`，它指向各个上下文的 `CONTEXT.md`。
- 与当前任务相关的 `CONTEXT.md`。
- 根目录 `docs/adr/` 中与当前工作相关的跨上下文 ADR。
- 对应 app 或 package 的 `docs/adr/` 中与当前工作相关的上下文级 ADR。

如果这些文件或目录尚不存在，直接继续，不要报告缺失，也不要预先建议创建。`/domain-modeling` 会在真正确定领域术语或架构决策时按需创建它们。

## File structure（文件布局）

本仓库采用 multi-context 布局：

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                         ← 影响整个系统的决策
├── apps/
│   └── <app>/
│       ├── CONTEXT.md
│       └── docs/adr/                 ← app 内部决策
└── packages/
    └── <package>/
        ├── CONTEXT.md
        └── docs/adr/                 ← package 内部决策
```

只有拥有独立领域词汇或架构决策的 app/package 才需要自己的上下文文档，并非每个 workspace package 都必须创建。

被 `pnpm-workspace.yaml` 排除的归档应用不需要活跃的上下文文档，除非重新开始维护。

## 使用领域词汇表中的术语

当输出内容需要命名领域概念时，例如 Issue 标题、重构提案、假设或测试名称，应使用相关 `CONTEXT.md` 中定义的词汇。不要随意切换为词汇表明确避免的同义词。

如果需要的概念尚未记录，应重新判断它是否真的是项目使用的语言；如果确实存在缺口，则将其交给 `/domain-modeling` 处理。

## 标明与 ADR 的冲突

如果拟议工作与现有 ADR 冲突，应明确指出，而不是静默覆盖：

> 与 ADR-0007（event-sourced orders）冲突，但可能值得重新讨论，因为……
