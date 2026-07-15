# kith-inn

![kith-inn logo](./kith-inn-logo.png)

> **口号：廛闬扑地，歌吹沸天。**
>
> 社区私房菜助手。中文名 **「街坊味」**，英文代号 **kith-inn**（kith=街坊邻里 + inn=小馆，连读谐音 "kitchen"）。

通过社区街坊里的"生产者"把邻里重新连接起来。项目级定义见：

- 产品需求（PRD）：[PRD.md](./PRD.md)
- User stories：[USER-STORIES.md](./USER-STORIES.md)
- 技术规格（Tech Spec，**架构以此为准**）：[TECH-SPEC.md](./TECH-SPEC.md)
- 数据建模参考：[DATA-MODEL.md](./DATA-MODEL.md)
- 高保真原型：[prototype/kith-inn-high-fidelity-prototype.png](./prototype/kith-inn-high-fidelity-prototype.png)

## 代码入口

- CMS / 后端 / 前端 / Payload 模块 / 共享类型分别在 `apps/cms`、`apps/kith-inn-be`、`apps/kith-inn-fe`、`packages/kith-inn-payload`、`packages/kith-inn-shared`。
- 新 feature 按 Spec Kit 推进，feature 文档放在仓库根目录的 `specs/` 下，并使用 `kith-inn` 作为 feature 名称前缀。
- 本目录只保留 kith-inn 的长期产品 / 技术材料，不维护另一套 PR 粒度任务清单。
