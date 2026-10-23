# 宝宝日记

当前实施阶段是把原宝宝日记的可视化迁入 `cfp-mono`。客户端采用本仓库的 Taro 技术栈；数据仍由 `sunmer-home/apps/bubu-log` 的既有 Payload CMS 后端维护。此阶段保持集合、字段、权限和统计逻辑，不迁移数据库。

## Language

**宝宝访问上下文**：原后端根据登录用户与 BabyUser 关系核验的宝宝及可访问宝宝列表。每个读取请求明确携带当前宝宝，切换时清除旧视图和详情。

**照护记录**：原 Activity，包括睡眠、尿布、亲喂、瓶喂、吸奶和其他全部 15 类活动。界面显示原字段，不发明来源、待补状态或不存在的喂养数据。

**每日统计**：后端已保存的 DailyStat。趋势和热力图读取其原始数值，缺失代表没有统计快照，不代表活动为零。首页与记录列表的 Activity 摘要分别沿用旧口径，不与 DailyStat 合并计算。

**日历地图**：日时间轴、七列周历与近四周热力图组成的可视化；不是地理位置地图。日轴是默认首页。

**旧账号登录**：过渡期复用 NextAuth 的用户名/密码会话；不是 `wx.login`。后续微信身份认证由独立模块提供。

## Module boundaries

当前模块负责读取、筛选、排序、可视化和只读详情。`src/api` 隔离旧协议，`src/model` 保留展示与摘要规则，`src/components` 不持有写入能力，页面负责宝宝、日期和选择状态。现有照片 URL 原样读取与预览。

用户已指定另外五个模块：Agent/MCP 录入、程序内对话、微信小程序认证、Payload CMS 运营、付费会员。内置对话及待补事项后续融合，当前不接入通用祝福会话或 Hello Agent 的领域模型；不建立占位字段或固定录入表单。首期产品限时免费的安排仍以 PRD 为准。

详细产品要求与实施顺序在 [MVP PRD](https://github.com/code-for-people-2026/cfp-mono/issues/391)、[六模块规划](https://github.com/code-for-people-2026/cfp-mono/issues/392) 和 [可视化模块](https://github.com/code-for-people-2026/cfp-mono/issues/394)，运行与迁移边界见 [README](README.md)。
