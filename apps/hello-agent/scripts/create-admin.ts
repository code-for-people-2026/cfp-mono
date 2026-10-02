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
const payload = await cms();
try {
  if (
    (await payload.count({ collection: "admins", overrideAccess: true }))
      .totalDocs > 0
  ) {
    console.error("已有管理员，拒绝通过初始化脚本添加或重置。");
    process.exitCode = 1;
  } else {
    await payload.create({
      collection: "admins",
      overrideAccess: true,
      context: { helloAdminBootstrap: true },
      data: { email, password },
    });
    console.log(
      "已创建本地 CMS 管理员。请清除初始化环境变量，通过 /admin 登录。",
    );
  }
} finally {
  await payload.destroy();
}
import "./load-local-env";
