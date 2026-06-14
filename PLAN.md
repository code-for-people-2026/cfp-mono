# cfp-mono 初始化计划

## 目标

把 `cfp-mono` 初始化为码成工 / Code for People 的单体仓库（monorepo）基础。

第一个里程碑不做业务重产品，而是做一个小而完整、偏生产可用的技术骨架。它需要证明主要应用入口可以本地运行、通过质量门禁，并具备部署到阿里云的路径。

## 应用结构

```txt
apps/
  site/          # Next.js + Payload CMS + Tailwind CSS + shadcn 演示，包含站点、后台和 API
  miniapp-fe/    # Taro + React 微信小程序前端演示，同时产出 H5

packages/
  ui/                  # 共享 shadcn 风格 Web UI 组件
  tailwind-config/      # 共享 Tailwind CSS 配置
  typescript-config/    # 共享 TypeScript 配置
  eslint-config/        # 共享 ESLint 配置
```

## 应用职责

- `apps/site`：公开主页演示和 Payload 管理后台放在同一个 Next.js 应用里，形态参考 `sunmer-home/apps/wedding-invite`。
- `apps/site`：第一阶段同时承担公开网站和小程序的共享后端，按需要暴露 Payload 集合和自定义 API 路由。
- `apps/miniapp-fe`：Taro 前端演示，目标端是微信小程序和 H5。H5 用于自动化测试和预览部署；微信小程序第一阶段手动测试。

第一阶段不增加 `apps/miniapp-be`，也不引入 NestJS 后端。如果未来小程序后端真的需要隔离，再从 `apps/site` 拆出来。

初始化阶段不增加业务领域包。共享包只保留基础设施和 UI 基础能力。

## 工程基线

- 包管理器：`pnpm`
- Monorepo 任务调度：`Turborepo`
- Git 仓库：通过 `git init` 初始化
- 本地数据库：Docker Compose PostgreSQL
- 根目录脚本：
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - `pnpm test:e2e`
  - `pnpm knip`
  - `pnpm build`
  - `pnpm verify`

各应用按需要暴露对应的本地脚本。

## 测试与质量要求

覆盖率门禁统一要求 100%：

- statements
- branches
- functions
- lines

Demo 代码要刻意保持小而清楚，让 100% 覆盖率有意义，而不是变成维护噪声。

预期检查项：

- ESLint，使用共享配置。
- TypeScript strict 类型检查。
- Knip，检查未使用文件、依赖和导出。
- Vitest 单元测试与覆盖率。
- Playwright E2E：
  - `site`：测试 Next.js 应用。
  - `miniapp-fe`：测试 Taro H5 产物。

微信小程序构建物第一阶段手动测试。等 AppID、上传密钥、开发者权限、合法请求域名都准备好之后，再考虑加入 WeChat DevTools 和 `miniprogram-ci` 自动化。

Playwright 失败时保留跟踪、截图和视频。

## CI

GitHub Actions 参考 `sunmer-home` 的“受影响应用”思路。

工作流：

- `.github/workflows/ci.yml`
  - 在 PR 和 `main` 分支推送时运行。
  - 安装依赖，运行 lint、typecheck、knip、100% 覆盖率单测、e2e 和构建。
  - 上传 coverage 与 Playwright 产物。
- `.github/workflows/deploy-preview.yml`
  - 在 PR 上运行。
  - 构建可部署应用。
  - 后续可按需要部署到阿里云预览环境。
  - 后续可把预览地址和测试摘要评论回 PR。
- `.github/workflows/deploy-production.yml`
  - 在 `main` 分支推送或手动触发时运行。
  - 构建生产镜像并推送到阿里云容器镜像服务 ACR。
  - 部署 `site` 和 `miniapp-fe` H5。
  - 部署后执行冒烟测试。

## 部署目标

生产环境使用阿里云。

第一阶段推荐的生产路径：

- 将 `apps/site` Docker 化。
- 将 `apps/miniapp-fe` 构建成 H5，并通过 Nginx 或等价静态 Web 容器提供访问。
- 将镜像推送到阿里云 ACR。
- 第一阶段部署到 ECS，通过 Docker Compose 管理容器。
- 生产数据使用阿里云 RDS PostgreSQL。
- 本地开发继续使用 Docker Compose PostgreSQL。

第一阶段走低运维成本的阿里云路线。可以把云资源这样理解：

- ECS：一台运行应用容器的 Linux 服务器。
- Docker Compose：ECS 上的容器进程管理方式。
- RDS PostgreSQL：Payload 使用的托管生产数据库。
- ACR 个人版：Docker 镜像仓库。
- Nginx 和 SSL：域名路由与 HTTPS。
- GitHub Actions：替代 Vercel 的构建、推送和部署流水线。

在出现真实扩容或运维需求前，先不引入 ACK/Kubernetes 等更重的阿里云产品。

域名拆分：

- `www.codeforpeople.cn` 或根域名：`apps/site`
- `miniapp.codeforpeople.cn`：`apps/miniapp-fe` H5

第一阶段 API 保持在 `site` 域名下，不单独增加 `api` 子域名。

`apps/miniapp-fe` 同时会构建微信小程序产物。小程序产物不直接部署到阿里云；第一阶段先手动测试，后续可以通过 `miniprogram-ci` 上传。

第一阶段使用一个 PostgreSQL 数据库和一个 Payload 应用。集合命名要保持清楚，方便未来拆分，但现在不引入多个数据库、多个数据库结构或多个 Payload 应用。

部署流程：

```txt
GitHub 推送
  -> CI 执行验证
  -> 构建 Docker 镜像
  -> 推送镜像到阿里云 ACR
  -> SSH 到 ECS
  -> docker compose pull && docker compose up -d
  -> 冒烟测试
```

如果 ICP 备案、DNS 或 SSL 还没准备好，可以先用 ECS 公网 IP 或临时域名做仅冒烟测试的验证。备案和证书完成后再切到正式域名。

## 许可证

本项目使用「牛马互助协议」作为开放项目许可证。

初始化时加入 `LICENSE.md`，并在 README 中明确说明项目使用的是「牛马互助协议」，不是 OSI 认可的标准开源许可证。

## 最终验收标准

- `git init` 已完成。
- `pnpm install` 成功。
- `docker compose up -d` 可以启动本地 PostgreSQL。
- `pnpm verify` 通过 lint、typecheck、knip、100% 覆盖率和构建。
- `pnpm test:e2e` 通过 `site` 和 `miniapp-fe` H5 自动化测试。
- `apps/site` 可以本地运行，包含公开主页和 Payload admin 路由。
- `apps/site` 为 `apps/miniapp-fe` 暴露 health/演示 API。
- `apps/miniapp-fe` 可以构建微信小程序演示。
- `apps/miniapp-fe` 可以构建并提供 H5 演示，且 Playwright 可以测试。
- GitHub Actions CI 可以通过。
- GitHub Actions 可以把 `site` 和 `miniapp-fe` H5 部署到阿里云。
- 生产冒烟测试通过：
  - `site /`
  - `site /admin`
  - `site` health/演示 API
  - `miniapp-fe` H5 首页
