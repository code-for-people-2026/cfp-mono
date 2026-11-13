# 登录与生日独立预览

此预览用于验收 #384 的两个简短窗口和真实微信账号绑定。用户已要求接通真实登录再发布；年龄核验及完整服务运营配置未就绪时，预览范围为登录与生日申报。

入口为 `scripts/onboarding-preview.ts`，独立 HTTP 进程使用共享的微信登录、凭证和年龄申报服务。仅挂载新的 `onboarding-preview.db`，不挂载现有聊天数据库、模型或年龄供应商密钥。生日只在客户端换算年龄段；服务端既不接受证件，也不提供聊天、聊天图片上传、外部连接或授权开通接口。`previewOnly` 仅改变界面提示，不授予任何权限。

部署必须设置 `HELLO_PREVIEW_SCOPE=login-and-birthday`、`HELLO_DEPLOYED=true`、`PAYLOAD_SECRET`、独立 `HELLO_DATABASE_URI` 和真实微信配置。健康检查明确返回 `scope: login-and-birthday`；没有修改完整服务的 readiness 检查。数据库按现有迁移初始化，登录资料/年龄申报记录在30天未操作后清除，启动及每小时执行；清理失败会终止进程。

登录限流还要求 `HELLO_TRUST_PROXY=true`：可信反向代理必须用实际客户端地址覆盖 `X-Real-IP`，应用端口只映射到宿主机回环地址，不能直接对外开放。每个来源独立限流，并另设全局上限；缺少可信来源时拒绝登录。

预览支持导出、删除与退出。现有聊天不迁移。停止预览时应下线独立路由和进程，并按告知的保留期限处理独立数据。

验证：`pnpm --filter @cfp/a-j-oker exec tsx scripts/onboarding-preview-check.ts` 使用临时库验证登录状态、年龄申报、功能关闭、导出删除和过期清理；它的合成微信交换仅用于测试。上线验收另用开发者工具真实 `wx.login` 验证生产微信交换。全服务仍需要真实年龄核验服务和完整隐私运营配置，此发布不宣称其已完成。

昵称与头像合在登录窗口内。服务端使用 MIT 的 [unique-names-generator 4.7.1](https://github.com/andreasonny83/unique-names-generator)，搭配正念、接纳、觉察、心流等中文词库及动物词库，随机账号标识作种子使默认资料稳定；这些名称不代表诊断。仅服务端引入该库，不增加小程序包体积。

照片头像先在客户端压缩，再经服务端验证格式、限制像素、去除元数据并裁剪为 256×256 JPEG；只保存私有 OSS 引用。`GET profile/avatar` 仅本人微信凭证可读取，外部连接无权读取资料。导出包含本人头像；删除和30天过期清理先清理对象再删除绑定，失败保留重试凭证。预览因此另需挂载已有 `HELLO_MEDIA_STORAGE=oss` 及 `HELLO_OSS_*` 服务端配置。上传请求上限 192 KiB，反向代理需相应允许 192k。聊天图片审核与聊天能力仍关闭。

发布镜像基于原预览运行环境，并将 `npm pack unique-names-generator@4.7.1` 得到的归档放在构建目录 `vendor/unique-names-generator-4.7.1.tgz`；Dockerfile 校验与锁文件相同的 SHA-512 完整性后解包。`overlay/` 仅来自已提交的服务端与共享包源码，不包含任何 `.env`、数据或本地凭证。

补充验证：`scripts/profile-check.ts` 覆盖空白默认资料、重复登录保留、非法资料拒绝、头像压缩/跨账号隔离、导出、对象删除失败重试；`scripts/age-verification-check.ts` 验证访客凭证不能读取历史，但仍可访问数据权利入口。
