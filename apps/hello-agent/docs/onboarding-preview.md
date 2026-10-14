# 登录与生日独立预览

此预览用于验收 #384 的两个简短窗口和真实微信账号绑定。用户已要求接通真实登录再发布；年龄核验及完整服务运营配置未就绪时，预览范围为登录与生日申报。

入口为 `scripts/onboarding-preview.ts`，独立 HTTP 进程使用共享的微信登录、凭证和年龄申报服务。仅挂载新的 `onboarding-preview.db`，不挂载现有聊天数据库、模型或年龄供应商密钥。生日只在客户端换算年龄段；服务端既不接受证件，也不提供聊天、上传、外部连接或授权开通接口。`previewOnly` 仅改变界面提示，不授予任何权限。

部署必须设置 `HELLO_PREVIEW_SCOPE=login-and-birthday`、`HELLO_DEPLOYED=true`、`PAYLOAD_SECRET`、独立 `HELLO_DATABASE_URI` 和真实微信配置。健康检查明确返回 `scope: login-and-birthday`；没有修改完整服务的 readiness 检查。数据库按现有迁移初始化，登录/年龄申报记录在30天未操作后清除，启动及每小时执行；清理失败会终止进程。

预览支持导出、删除与退出。现有聊天不迁移。停止预览时应下线独立路由和进程，并按告知的保留期限处理独立数据。

验证：`pnpm --filter @cfp/hello-agent exec tsx scripts/onboarding-preview-check.ts` 使用临时库验证登录状态、年龄申报、功能关闭、导出删除和过期清理；它的合成微信交换仅用于测试。上线验收另用开发者工具真实 `wx.login` 验证生产微信交换。全服务仍受 #383 的隐私运营依赖约束，此发布不宣称其已完成。
