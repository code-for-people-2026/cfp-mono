# 部署说明

本项目第一阶段采用低运维成本的阿里云部署路线，尽量适合原本更熟悉 Vercel、但还不熟悉云基础设施的人。

## 心智模型

- ECS：一台运行容器的 Linux 服务器。
- Docker Compose：在 ECS 上启动和更新应用容器。
- RDS PostgreSQL：Payload CMS 使用的托管 PostgreSQL。
- ACR 个人版：容器镜像仓库。
- Nginx 和 SSL：通过 HTTPS 将域名路由到容器。
- GitHub Actions：负责构建、推送、SSH 部署和冒烟测试。

第一阶段先不引入 Kubernetes/ACK。

## 生产目标

- `apps/site`：`www.codeforpeople.cn` 或根域名。
- `apps/miniapp-fe` H5：`miniapp.codeforpeople.cn`。
- API：第一阶段挂在 `site` 域名下。
- 微信小程序：构建为产物，第一阶段手动测试。

## 阿里云准备清单

1. 创建 ECS 实例。
2. 在 ECS 上安装 Docker 和 Docker Compose。
3. 创建 ACR 个人版镜像仓库。
4. 创建 RDS PostgreSQL 实例。
5. 创建 DNS 记录：
   - `www.codeforpeople.cn` -> ECS 公网 IP
   - `miniapp.codeforpeople.cn` -> ECS 公网 IP
6. 为两个域名配置 SSL 证书。
7. 中国大陆正式域名指向 ECS 前，先完成 ICP 备案。

## GitHub 密钥

生产部署工作流需要这些 GitHub Secrets：

- `ALIYUN_ACR_REGISTRY`
- `ALIYUN_ACR_NAMESPACE`
- `ALIYUN_ACR_USERNAME`
- `ALIYUN_ACR_PASSWORD`
- `ECS_HOST`
- `ECS_USER`
- `ECS_SSH_KEY`
- `DATABASE_URL`
- `PAYLOAD_SECRET`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_MINIAPP_H5_URL`

## 部署流程

```txt
GitHub 推送
  -> CI 运行 lint、typecheck、knip、测试、e2e 和构建
  -> 构建 Docker 镜像
  -> 推送 Docker 镜像到 ACR
  -> SSH 到 ECS
  -> docker compose pull
  -> docker compose up -d
  -> 冒烟测试
```

## 回滚

在服务器上保留上一个镜像标签。部署后如果冒烟测试失败，手动把镜像标签改回上一个版本，然后运行：

```bash
docker compose pull
docker compose up -d
```

## 临时验证

如果 ICP 备案、DNS 或 SSL 还没准备好，可以先用 ECS 公网 IP 或临时域名做仅冒烟测试的验证。备案和证书完成后再切换到正式域名。
