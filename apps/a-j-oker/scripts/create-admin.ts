export {};
const email = process.env.HELLO_ADMIN_EMAIL;
const password = process.env.HELLO_ADMIN_PASSWORD;
if (!email || !password || password.length < 12) {
  console.error(
    "请在本地设置 HELLO_ADMIN_EMAIL 与至少 12 位的 HELLO_ADMIN_PASSWORD；不要把密码提交到仓库。",
  );
  process.exit(2);
}
const { cms } = await import("../src/cms/client");
const { FirstAdminUnavailableError, registerFirstAdmin } = await import("../src/cms/first-admin");
const payload = await cms();
try {
  try {
    await registerFirstAdmin(payload, { email, password, confirmPassword: password });
    console.log(
      "已创建本地 CMS 管理员。请清除初始化环境变量，通过 /admin 登录。",
    );
  } catch (error) {
    if (!(error instanceof FirstAdminUnavailableError)) throw error;
    console.error("管理员初始化已关闭，拒绝添加或重置。");
    process.exitCode = 1;
  }
} finally {
  await payload.destroy();
}
import "./load-local-env";
