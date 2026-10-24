# 卜卜日记 ECS 体验环境

沿用 Hello Agent 的交付方式：现有 ECS、独立 Compose 项目、回环端口和 Nginx HTTPS 站点。项目为 `cfp-bubu-log`，目录为 `/opt/cfp-bubu-log`，端口为 `127.0.0.1:3320`。微信客户端使用真实身份与记录接口；不发布本机浏览器测试夹具。

## 构建

在完整 MVP 最后一层之上准备发布分支。先运行两个应用的类型检查和 lint、小程序测试、Weapp 构建及 `test:wxss`。`Dockerfile.preview` 的 `BUBU_BUILD_TYPES_VERIFIED=true` 仅用于类型检查已通过的构建，减轻小型 ECS 的内存压力。

源码归档采用文件白名单，仅包含服务源码、锁文件和所需共享配置。`Dockerfile.preview.dockerignore` 同样排除本机依赖、数据、环境变量、测试夹具和私密部署目录。镜像不含真实配置、证书、开发账号或本机照护数据。

```sh
docker build --memory=1536m --memory-swap=1536m \
  --cpu-period=100000 --cpu-quota=100000 \
  -f apps/bubu-log-service/Dockerfile.preview \
  -t cfp-bubu-log:<release> .
```

## 配置与启动

- `private/runtime.env` 保存 `.env.example` 中的服务端配置，权限 `0600`；包括自己的微信 AppID/AppSecret、独立 Payload secret、原 CMS 的专用服务账号和真实模型配置。微信密钥只在服务端。
- `BUBU_PUBLIC_ORIGIN` 与 `BUBU_OPS_ORIGIN` 使用当前 HTTPS 域名，`HOST=0.0.0.0`、`PORT=3320`、`BUBU_IDENTITY_DIRECTORY=/data`。
- 证书文件为 `private/fullchain.pem` 和 `private/privkey.pem`。配置和私钥按 Hello Agent 方案经目标机器的临时传输证书加密发送，不进入云助手脚本文本或日志。
- 原 Baby、BabyUser、Activity、DailyStat 仍在原 Payload 后端。新服务只新建自己的身份、记录元数据、对话、运营和权益 SQLite，不迁移原库，不导入本机合成数据。
- 使用 `compose.preview.yml`，在独立目录 `.env` 设置 `BUBU_PREVIEW_IMAGE`。数据初始化容器只准备目录归属和 `0700` 权限；应用以非 root 用户运行。

首次管理员由 `cms:admin` 创建。把随机密码保存在私密 `ops.env`，只临时传给一次性命令：

```sh
set -a
. private/ops.env
set +a
docker compose -f compose.yml run --rm \
  -e BUBU_OPS_ADMIN_EMAIL -e BUBU_OPS_ADMIN_PASSWORD -e BUBU_OPS_ADMIN_BABY_IDS \
  app node --import tsx scripts/create-admin.ts
unset BUBU_OPS_ADMIN_EMAIL BUBU_OPS_ADMIN_PASSWORD BUBU_OPS_ADMIN_BABY_IDS
docker compose -f compose.yml up -d app
```

新管理员默认宝宝范围为空；之后明确授予所需宝宝范围，不自动授予全部家庭数据访问权。

## HTTPS 与微信

替换 Nginx 模板的域名与已有运营网络白名单。只公开 `/health`、`/api/identity/` 和 `/api/app/`；MCP、Payload、运营接口保留网络白名单与应用鉴权。容器端口不对公网开放。必须在回环健康检查通过后安装站点配置，并先 `nginx -t` 再 reload。

微信后台需将此 HTTPS 域名加入 request、uploadFile、downloadFile 合法域名。小程序构建的 `BUBU_API_ORIGIN` 必须使用同一地址。实际 AppID 的登录 code 交换、照片和真机网络验收通过后，才能将体验环境称为可用。上传开发版本与在后台指定体验版本是两个步骤，分别记录结果。

微信支付保持关闭，群采集不会因服务启动自动开通或运行。

## 验证、备份与回滚

至少检查公网有效证书、`/health`、无凭证请求被拒绝、后台访问限制、原 CMS 专用账号、真实模型、微信登录及真机客户端。健康接口只表示运行实例已初始化，不替代旧库与第三方接口验收。

每次升级前，只停止本项目应用，再完整归档 `data/`（SQLite、附件及元数据）和私密配置，验证归档可读；保留上一镜像和 Nginx 配置。新库首次初始化后也保留备份。需要回滚时一起恢复匹配的数据、配置与镜像，不能只回退镜像掩盖迁移问题。不停止其他 Compose 项目，不执行全局镜像清理。

证书沿用本机 DNS-01 签发和加密传输方式；续期后需要重新部署证书并验证 Nginx reload。本方案没有声称已部署证书自动续期或自动备份。
