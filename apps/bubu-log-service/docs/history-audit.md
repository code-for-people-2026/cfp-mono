# 历史映射核对

本模块沿用原 Activity/Baby/BabyUser/DailyStat，开发阶段没有迁移或改写真实客户数据。原始历史记录按原字段保留，缺少新来源/完整性metadata时不猜测默认值来源，也不批量建立历史追问；用户主动编辑后才采用新完整性规则。

映射以原 Payload Activities 集合为准：`id,babyId,type,startTime,endTime,hasPoop,hasPee,poopColor,poopPhotoUrl,peeAmount,burpSuccess,milkAmount,milkSource,breastFirmness,supplementType,spitUpType,count,notes,createdAt,updatedAt`。旧TypeScript的recordTime命名不替换实际startTime。旧BOTTLE.milkAmount仍为原保存奶量，PUMP.milkAmount仍为吸出量；不反推泡好量。新增泡好量、余量、同瓶证据、来源与状态只保存在sidecar元数据。

先在获准的运维环境完成一致备份，再从旧库和候选切换环境分别导出JSON：

```json
{"activities": ["此处实际放完整Activity对象"], "dailyStats": ["可选的DailyStat对象"]}
```

核对工具只读本地JSON，不访问数据库或网络；输出路径必须是新文件，不覆盖既有报告：

```sh
pnpm --filter @cfp/bubu-log-service audit:history --before /private/original.json --after /private/mapped.json --out /private/new-audit.json
```

报告按宝宝、15类活动核对记录数、原ID、字段变化、照片关联数量/变化、日期覆盖、逐日关键指标，以及零值与未知数量。已导出DailyStat会逐项与事实重算对照。旧UI把小/中尿布折算、未知奶量显示0、翻身/拉坐缺次数或0回退1，与新实际次数/未知覆盖的差异独立列出，不能把这些口径调整误报成事实丢失。

退出码0表示所提供内容核对通过，1表示映射或已导出日报不一致，2表示输入/IO错误。单份输入的`preserved:null`表示没有做前后对比；未导出日报的`statisticsMatch:null`表示尚未比对已存日报，不能据此宣称完整迁移通过。报告不包含备注原文或照片URL。身份映射、Baby/BabyUser关系、原图可读取性和真实权限仍需按身份模块流程另行验收，此工具不替代它们。

测试覆盖合成15类、日期/宝宝移动、图片变更、数值变化、跨日30/60分钟、旧折算、失效日报、非法输入和真实CLI退出码。没有真实客户迁移验收结论。
