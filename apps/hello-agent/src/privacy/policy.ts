import { ageNotice } from "../age/policy";
import { createHash } from "node:crypto";
import { deletionLedgerPath } from "./deletion-ledger";

export const COMPANY = "码成仝软件（深圳）有限公司";
const positiveDays = (value: string | undefined) => value && /^[1-9]\d{0,3}$/.test(value) ? Number(value) : undefined;
export function privacyPolicy() {
  const contact = process.env.HELLO_PRIVACY_CONTACT?.trim() || "待公司配置；当前仅供本地验收";
  const retentionDays = positiveDays(process.env.HELLO_PRIVACY_RETENTION_DAYS);
  const backupDays = positiveDays(process.env.HELLO_PRIVACY_BACKUP_DAYS);
  const responseDays = positiveDays(process.env.HELLO_PRIVACY_RESPONSE_DAYS);
  const deployment = process.env.HELLO_PRIVACY_STORAGE_LOCATION?.trim();
  const imageReview = process.env.HELLO_IMAGE_REVIEW_MODE === "aliyun-green" ? {
    name: "阿里云计算有限公司（内容安全增强版）", contact: "https://www.aliyun.com/contact", region: "中国内地上海", policy: "https://help.aliyun.com/zh/document_detail/2705225.html",
  } : process.env.HELLO_IMAGE_REVIEW_URL?.trim() ? {
    name: process.env.HELLO_IMAGE_REVIEW_PROVIDER,
    contact: process.env.HELLO_IMAGE_REVIEW_CONTACT,
    region: process.env.HELLO_IMAGE_REVIEW_REGION,
    policy: process.env.HELLO_IMAGE_REVIEW_PRIVACY_URL,
  } : undefined;
  const imageReviewDisclosed = !!imageReview && Object.values(imageReview).every((value) => !!value?.trim());
  const ready = !!(process.env.HELLO_PRIVACY_CONTACT?.trim() && retentionDays && backupDays && responseDays && deployment && deletionLedgerPath() && process.env.HELLO_PRIVACY_OPERATIONS_APPROVED === "true");
  const documents = [
    { title: "隐私政策", paragraphs: [
      `运营者：${COMPANY}（深圳龙岗）。隐私权利联系渠道：${contact}。${responseDays ? `将在 ${responseDays} 日内答复权利请求。` : "权利请求答复期限待公司确认。"}`,
      "打开页面可先阅读政策。继续使用前由你主动同意；拒绝不影响阅读政策。未登录时建立随机访客身份以提供反馈和数据权利。你主动同意并在微信操作登录后，服务器通过微信登录接口取得 OpenID，并只保存绑定微信账号的标识摘要用于恢复记录，不获取手机号、通讯录或定位。浏览器 Cookie / 小程序本地凭证有效期 30 天，外部连接令牌 7 天。服务器保存凭证摘要，不保存令牌明文。这里的匿名身份只是随机设备标识，含对话内容的记录并不等于法律意义上的匿名化数据。设备权限许可不能代替本页授权。同意与近期操作历史最多保存 64 条且总量不超过 128 KiB，并保留最近一次同意的政策快照；较旧记录会压缩清理。重复提交相同有效授权不延长有效期。",
      "文字、你选择的图片和练习回传用于生成回应、内容安全检查、保存及恢复祝福会话；历史、摘要和近期输入会参与后续生成与记忆整理。图片压缩为 JPEG、移除原始 EXIF 和定位信息后保存在私有存储中；已有有效 AIGC 来源标识会保留；未点发送但已上传的图片也会保存，随删除一起清理。我们不将这些内容用于训练模型或广告画像。反向代理访问日志可能记录 IP、时间、请求路径和状态，用于安全与故障排查；日志保存与轮转期限由公司另行核实，不承诺由聊天删除按钮逐条擦除。",
      "情绪练习、健康经历、照片中的人脸及其他可识别敏感信息可能对个人权益产生较大影响。只有你另行选择敏感信息处理，才可上传图片、提交练习或继续将包含此类信息的历史交给模型。文字检测只是辅助，不能识别所有敏感信息；未单独同意时请只发送普通文字。用途限你要求的回应和安全审核；可不用这些功能，普通文字功能仍可使用。请勿提交身份证、金融账户、精确行踪、他人隐私或不必要的病历。单独同意不代表允许无限收集。",
      `当前数据保存位置：${deployment || "待公司核实数据库、OSS 及供应商实际地域"}。${retentionDays ? `在线记录在当前身份最后一次同意后最多保留 ${retentionDays} 天，到期由维护任务删除；续用需要重新告知和同意。` : "在线记录自动到期期限尚未配置，当前不会宣称自动到期删除；正式开放前必须配置并启用维护任务。"} 生成轮次、摘要、执行轨迹、练习、上传图片、凭证及同意记录均在这一身份范围管理。执行轨迹可能含输入和工具输出，不是匿名统计。`,
      "你可在“隐私与数据”查阅记录，导出本人对话、摘要、图片及授权信息，生成恢复码、撤回同意、删除及退出。内部执行快照可能混有后台参考资料，不直接提供自助下载；如需其中的本人数据，可通过本政策联系渠道申请核验副本。自助导出上限为 8 MB 或 1000 条记录，超限不生成不完整文件，可通过本政策联系渠道申请完整副本。导出含私密对话，请自行保管。退出或删除会清理本应用记录的临时下载文件；操作系统缓存、设备备份及你自行导出或分享的副本不由平台自动删除。撤回后停止新生成、上传和外部读取并列入清理；清理前仍可查阅与删除；已经发出的供应商请求无法从网络中召回。更正可通过权利联系渠道申请，也可删除后重新提交。",
      "删除先冻结继续处理，再删除会话、轮次、摘要、执行轨迹、执行锁、图片、微信绑定、昵称头像、年龄申报/核验及所有连接凭证；OSS 失败时保留待删除状态及必要引用供重试，不假称成功。没有独立缓存的几何 PNG、HTML 随原记录删除后无法读取。通过联系渠道另行处理的权利请求及相关记录，由公司按告知的用途和期限管理，不属于普通聊天自动删除范围。",
      `删除是在线应用层清除，不承诺立即永久抹除磁盘、日志或备份。${backupDays ? `备份最长保留 ${backupDays} 天，仅限恢复及安全保护，到期按批准的备份作业销毁。` : "备份保留上限及清理作业待公司核实配置；现有发布回退备份可能含历史数据。"} 恢复备份前必须重放独立保存的删除清单，防止已删数据重新出现；对象版本、托管快照与日志的清理也须按实测配置执行。供应商侧留存按其协议另行处理。为阻止迟到写入及备份恢复复现，暂留最小删除防护记录（身份引用/摘要与删除时间），不含聊天正文；其到期清理须在确认备份均已处置后执行，运营方案待公司确认。`,
      "微信登录绑定可恢复同一账号的记录，不能证明真实姓名或年龄。旧访客记录只有在持有有效凭证并明确选择保留时绑定；已有微信记录时不会自动合并其他历史。恢复码不能替代微信登录或年龄核验权限。未绑定微信的访客身份没有实名认证绑定。请在退出或清缓存前导出数据并保管恢复码；恢复码等同访问凭证，勿公开。有效凭证或恢复码可行使导出和删除权利；聊天读取仍需微信登录；两者都丢失时可联系公司提出请求，但必须先核验归属，不能凭聊天描述自动找回，也不保证能定位。到期身份仍可用恢复码行使权利，已完成删除的内容无法恢复。",
      "政策、接收方或用途变化会更新版本并要求重新同意。未成年人保护、危机处置和拟人化服务专门措施另行建设，本页同意不替代法定监护人同意或相应上线条件。",
    ] },
    { title: "第三方处理说明", paragraphs: [
      "DeepSeek（杭州深度求索人工智能基础技术研究有限公司）：平台与 BYOK 均由我们的服务器通过 DeepSeek API 发送输入、必要历史/摘要、图片（当前模型支持时）、生成作品及安全审核所需文本。BYOK 密钥仅存在本次请求内存，不写入业务库；不用自己密钥不影响平台模式。外部 MCP 保存的输入与作品仍可能送 DeepSeek 做安全审核。隐私说明：https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html；API 数据留存、受托处理条款和是否用于训练须由公司与供应商协议核实，不将平台自身“不训练”承诺扩展为供应商承诺。",
      imageReview ? `图片内容审核接收方：${imageReview.name || "待配置"}；联系方式：${imageReview.contact || "待配置"}；处理地域：${imageReview.region || "待配置"}；隐私说明：${imageReview.policy || "待配置"}。仅发送压缩后图片像素，用于安全审核；返回判定、版本与类别。平台用审核结果决定是否接收图片，不单独保存审核摘要；未通过审核的图片不会进入平台私有图片库。供应商留存须由公司确认；告知未齐时图片处理入口不放行。` : "图片审核：当前未配置审核接收方，聊天图片会暂停接收；启用前必须公布供应商名称、联系渠道、地域及政策，并重新取得同意。",
      "阿里云（阿里云计算有限公司）：部署启用 OSS 时存放私有图片，服务器存放数据库；只由有权限的服务读取，不公开桶或长期链接。具体地域、对象版本及备份期限由公司核实后写入政策。隐私说明：https://help.aliyun.com/zh/document_detail/2705225.html。",
      "外部 MCP：只有你分别开启外部访问和敏感信息处理、填写接收方并主动交出连接令牌后，你选择的客户端及其模型服务商才能读取该身份下的全部历史、摘要和图片并提交作品。历史、作品和摘要可能包含无法靠关键词识别的敏感信息，因此没有敏感信息处理授权时不签发或放行外部连接。授权时须填写实际客户端及模型接收方名称、联系方式、地域与政策链接；每次更改授权会撤销原令牌。其留存由你选择的服务决定，平台不能替你保证；使用前请核查其政策，勿连接身份或处理地域不明的服务。撤销令牌阻止未来访问，不能删除接收方已取得的副本。",
      "微信小程序及设备能力由腾讯提供。启用 WechatSI 时，你主动按住说话才会请求录音权限，由腾讯插件识别音频并返回文字。浏览器语音能力由所在浏览器提供；不支持时可用键盘。识别结果先进入草稿，仅在点击发送后作为文字交给平台；平台不保存录音文件。音频在识别供应商侧的地域与留存须在发布前核实并告知，不以平台不保存替代供应商说明。图片仅由你主动选择；系统录音、相册和相机权限可在设备设置撤回。",
      "激励广告只有配置启用时才调用微信激励广告组件，腾讯处理广告展示/观看交互，平台只保存观看资格与消耗状态，不向广告接口传聊天正文。当前是否启用以页面显示为准。第三方处理条款、跨境情形及敏感信息影响评估未核实前不得公开开放相应处理。",
    ] },
    { title: "微信登录与年龄核验说明", paragraphs: ageNotice().paragraphs },
    { title: "服务协议与 AI 标识", paragraphs: [
      `阿 J 先生 由${COMPANY}提供，是 AI 互动工具。文字、表格、卡片、练习、插画和网页可能错误，不构成医疗诊断、治疗、预测或结果保证。欢迎语及聊天持续提示 AI 身份。`,
      "生成回应及作品周边持续显示“AI 生成”，复制回应会带此提示；下载的几何 PNG 在图像边缘显示提示，并在 AIGC 元数据记录生成属性、服务提供者和内容编号；独立 HTML 在正文与 head 元数据中添加标识。外部产物注明来源由客户端声明、未经独立核验。用户上传原图不被标为平台生成，引用原图的作品说明仍标注为 AI 生成编排。",
      "请保留显式与隐式标识；通过其他平台发布时主动声明为 AI 生成并使用该平台的标识功能，不得恶意删除、篡改或隐匿标识。当前不提供去标识导出。转存、截图、第三方重新编码可能损失元数据，请保留可见标识。",
      "禁止提交违法、侵权及他人不必要个人信息。你可以停止使用、撤回授权、撤销外部连接或删除数据。权益咨询与争议沟通使用隐私政策所列渠道；条款不排除你的法定权利。当前版本为本地整改验收，不表示任何备案、审批或全量合规已完成。",
    ] },
  ];
  const version = `2026-10-13.${createHash("sha256").update(JSON.stringify(documents)).digest("hex").slice(0, 16)}`;
  return { version, ready, contact, retentionDays, backupDays, responseDays, imageReviewDisclosed, documents };
}
