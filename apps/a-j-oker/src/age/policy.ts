import { createHash } from "node:crypto";
export function ageProvider(): "aliyun" | "tencent" { return process.env.HELLO_AGE_PROVIDER === "aliyun" ? "aliyun" : "tencent"; }
export function ageNotice() {
  const aliyun = ageProvider() === "aliyun";
  const paragraphs = [
    "昵称和头像用于本人账号展示，不发送给模型、不用于识别人脸或判断心理状态。可选用微信昵称和头像，也可自行填写；留空时分配随机昵称与动物头像。资料随账号保存，可在隐私与数据中导出或删除，重新登录时可更换。",
    "微信登录仅确认当前微信账号，不会返回年龄，也不代表你已完成实名认证或年龄核验。年龄申报由你填写，不能代替第三方核验。",
    aliyun ? "年龄核验用于确认适用的保护措施和更正误填的生日。你单独同意并提交后，本人姓名和中国大陆居民身份证号码通过加密连接送至阿里云信息核验服务，由其向合法保存信息的权威机构核对真实性和一致性，并返回核验结果。仅匹配通过后，本服务根据证件中的出生日期计算年龄段，不保存完整生日。无需身份证照片，不采集人脸、手机号或设备号。" : "年龄核验用于选择适用的保护措施。你单独同意并点击提交后，姓名和中国大陆居民身份证号码经本服务端仅送腾讯云（腾讯云计算（北京）有限责任公司）人脸核身服务的未成年人识别接口进行姓名证件匹配及年龄段查询。无需身份证照片、不采集人脸或手机号。",
    `身份信息属于敏感个人信息，泄露可能影响人身、财产权益。平台仅在请求内存处理姓名证件，不写入业务库、应用日志或发给模型。${aliyun ? "阿里云信息核验服务协议：https://terms.alicdn.com/legal-agreement/terms/b_end_product_protocol/20230913121017185/20230913121017185.html 。" : "腾讯云处理地域、留存期限、权利渠道及受托条款须由公司在开通前核实；尚未核实不会开放提交。腾讯隐私说明：https://cloud.tencent.com/document/product/301/11470 。"}`,
    `已确认的供应商处理说明：${process.env.HELLO_AGE_PROVIDER_DISCLOSURE?.trim() || "尚待公司确认，本地仅可使用合成测试"}。`,
    "平台保存绑定当前微信身份的申报年龄段、核验成年/未成年/未知结果、来源、请求凭证、单独同意版本、核验时间与有效期（本产品设为30天）。未完成使用授权的登录与核验记录在最后操作30天后纳入隐私清理任务；已授权记录随账号保留期限管理，也可主动删除；不保存完整生日或证件原文。结果仅表示所填姓名证件对应的年龄段，不证明此刻操作者就是证件本人。必要时会暂停相关功能并要求另行复核；本版不启用人脸核验。",
    "未满14岁请勿填写姓名证件，先通过帮助与反馈由监护人申请数据权利或误判申诉支持。若先前生日误填且本人已满14岁，可选择重新核验；更正必须以本人姓名和身份证的核验结果为准，不能仅修改生日解除限制。本次申报仅提供成年人服务；未成年或无法确认时，无法开始AI对话、图片上传或广告整理。仍可阅读政策、查阅已有记录及行使数据权利，不开放监护人同意后继续使用AI功能的入口。自带密钥和外部Agent/MCP对所有用户关闭。",
    "可拒绝或取消核验；服务不可用、查无结果、失败、过期均不会被当作成年。已核验未成年人或申报冲突需复核。可在帮助与反馈中申诉，也可在隐私与数据中导出、更正申请、撤回或删除。请勿在反馈中填写完整证件号码。",
  ];
  return { version: `age-v1.${createHash("sha256").update(JSON.stringify(paragraphs)).digest("hex").slice(0, 16)}`, paragraphs };
}
export function wechatConfigured() { return !!(process.env.HELLO_WECHAT_APP_ID && process.env.HELLO_WECHAT_APP_SECRET); }
export function providerConfigured() {
  if (process.env.HELLO_AGE_PROVIDER && !["aliyun", "tencent"].includes(process.env.HELLO_AGE_PROVIDER)) return false;
  return !!(process.env.HELLO_AGE_SECRET_ID && process.env.HELLO_AGE_SECRET_KEY && process.env.HELLO_AGE_PROVIDER_APPROVED === "true" && process.env.HELLO_AGE_PROVIDER_DISCLOSURE?.trim());
}
