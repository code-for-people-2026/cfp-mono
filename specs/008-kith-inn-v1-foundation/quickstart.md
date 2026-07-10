# 快速验证：kith-inn-v1 M0

## 前置条件

- Node.js 20+
- pnpm 10.2
- Docker（用于本地 PostgreSQL 集成验证）

## 初始化共享 CMS

1. 安装 workspace 依赖：

```bash
pnpm install
```

2. 启动仓库本地 PostgreSQL：

```bash
pnpm db:up
```

3. 按现有 `apps/cms/.env.example` 配置 `PAYLOAD_DATABASE_URL` 和 `PAYLOAD_SECRET`。v1 不增加第二套数据库连接或 Payload secret。

4. 连续执行两次共享 seed：

```bash
pnpm --filter @cfp/cms seed
pnpm --filter @cfp/cms seed
```

预期：第一次分别初始化旧项目和 v1；第二次两边都幂等跳过。v1 最终只有一条桃子 seller 和一条 v1 operator。

## 启动与手工 smoke

```bash
pnpm --filter @cfp/cms dev
```

验证：

1. 打开 `http://localhost:3304/api/health`，仍返回 `{ "status": "ok" }`。
2. 打开 `http://localhost:3304/admin`，用现有共享 CMS Admin 账号登录。
3. 确认旧 kith-inn collections 仍在原分组。
4. 确认七个 v1 collections 出现在“街坊味 v1 / ...”分组。
5. 确认 v1 桃子 seller/operator 存在，其他 v1 collections 初始为空。
6. 确认没有 3305 端口或第二个 Payload 进程。

## 自动化检查

先运行窄检查：

```bash
pnpm --filter @cfp/kith-inn-v1-shared test:coverage
pnpm --filter @cfp/kith-inn-v1-payload test:coverage
pnpm --filter @cfp/cms test
```

最小必证：

- 日期、金额、份数和全部枚举 schema 的成功/失败分支。
- 所有 v1 collection slug 都以 `kiv1_` 开头，数量正好为七。
- 未认证默认拒绝；共享 CMS Admin 可检查 v1 数据。
- 顶层、has-many 和 menuItems 嵌套 relationship 的跨 v1 seller 引用全部被拒绝。
- 普通复合唯一索引拒绝同 seller 下重复的 operator、meal slot、菜名和 profile + slot 订单。
- 同一 wechatOpenid 可在两个 seller 下各创建一条 operator membership，且两个 seller 的数据互相隔离。
- seed 首次创建、再次跳过、共享编排失败后可重试。
- PostgreSQL `cms` schema 同时含旧表和 `kiv1_` 表；`website`/`public` schema 不出现 v1 表。
- Payload config 的 schema、Admin user、端口、健康检查和旧 collection 清单不变。

最后运行仓库门禁：

```bash
pnpm verify
```

## 本里程碑不验证

- 新的 Payload app、端口或部署
- v1 Hono backend 与 Taro frontend
- `wx.login`、openid 换 session
- 菜品 CRUD、批量导入、菜单生成
- 订单确认/付款/送达动作
- 分享卡片和顾客预订登记
- 接龙导入或任何 AI 能力
