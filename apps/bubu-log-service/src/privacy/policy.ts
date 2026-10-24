import { createHash } from "node:crypto";

export interface PrivacyConfig {
  company: string; contact: string; storageLocation: string; legacyStorageLocation: string;
  chatDays: number; backupDays: number; orphanHours: number; responseDays: number;
  modelName: string; modelRegion: string; modelPolicy: string;
}
const positive = (value: string | undefined, maximum: number) => value && /^[1-9]\d*$/.test(value) && Number(value) <= maximum ? Number(value) : 0;
export function privacyConfigFromEnv(): PrivacyConfig {
  return {
    company: process.env.BUBU_PRIVACY_COMPANY?.trim() || "", contact: process.env.BUBU_PRIVACY_CONTACT?.trim() || "",
    storageLocation: process.env.BUBU_PRIVACY_STORAGE_LOCATION?.trim() || "", legacyStorageLocation: process.env.BUBU_PRIVACY_LEGACY_STORAGE_LOCATION?.trim() || "",
    chatDays: positive(process.env.BUBU_PRIVACY_CHAT_DAYS, 3650), backupDays: positive(process.env.BUBU_PRIVACY_BACKUP_DAYS, 365),
    orphanHours: positive(process.env.BUBU_PRIVACY_ORPHAN_HOURS, 720), responseDays: positive(process.env.BUBU_PRIVACY_RESPONSE_DAYS, 30),
    modelName: process.env.BUBU_PRIVACY_MODEL_NAME?.trim() || "", modelRegion: process.env.BUBU_PRIVACY_MODEL_REGION?.trim() || "",
    modelPolicy: process.env.BUBU_PRIVACY_MODEL_POLICY?.trim() || "",
  };
}
export function privacyPolicy(config: PrivacyConfig) {
  const ready = Object.values(config).every(Boolean) && /^https:\/\//.test(config.modelPolicy);
  const documents = [
    { title: "隐私政策", paragraphs: [
      `运营者：${config.company || "待确认"}。隐私联系渠道：${config.contact || "待配置"}。${config.responseDays ? `将在 ${config.responseDays} 天内答复隐私请求。` : "答复期限待确认，当前尚未完成上线配置。"}`,
      "卜卜日记面向成年监护人及其授权照护者，用来记录和回顾宝宝日常。请先阅读并主动选择；拒绝不影响阅读政策和申请数据权利。微信登录取得 OpenID 的摘要建立账号，不获取手机号、通讯录或定位。小程序登录凭证在设备上保存，服务器仅保存其摘要，有效期 7 天。",
      "宝宝昵称、照护时间、奶量、睡眠、排泄、照片等涉及儿童及敏感个人信息。监护人须对宝宝档案单独授权；照护者须声明已成年、获得照护授权，并为自己的信息处理作出选择。姓名、照片和语音均不是必填项。不会将图片用于人脸识别。",
      "照护记录和已关联照片保留至监护人主动删除；账户注销与删除家庭记录不同。注销删除本人登录身份、私人对话，以及已证明绑定的原账号资料、密码、第三方登录凭证和家庭授权关系。旧账号不能再恢复原家庭权限；微信重新注册从空白身份开始。不擅自删除其他照护者共同使用的家庭记录及必要照护来源，审计中的原账号身份引用会清除。监护人可另外发起家庭数据删除；处理期间冻结访问和写入，失败显示待重试，不能把业务撤销误记说成彻底删除。",
      `已完成的聊天与群消息原文保存 ${config.chatDays || "待确认"} 天；未确认的任务会暂停清理并进入运营异常队列，需先核对保存结果，不能宣称此时原文已删除。未关联照片 ${config.orphanHours || "待确认"} 小时后清理。备份保存 ${config.backupDays || "待确认"} 天，隔离保存且只用于恢复；恢复必须先重放独立删除清单，不能恢复已删除的数据。依法需保留的最小安全记录另行隔离，不用于模型或营销。`,
      `运行数据库与新照片位置：${config.storageLocation || "待核实"}；原照护数据位置：${config.legacyStorageLocation || "待核实"}。历史公开照片不能仅靠新接口鉴权追溯撤销，必须完成原对象迁移与访问关闭；未完成时不会宣称所有照片已私有化。`,
      "模型、照片和群采集分别授权，撤回后阻止后续处理；撤回不能追回第三方已经收到的副本。账号注销会退出登录并清除本机该账号的草稿、临时照片及凭证。导出的副本由你保管。",
    ] },
    { title: "儿童信息与监护人授权", paragraphs: [
      "首次处理宝宝信息前，由拥有宝宝管理权限的成年监护人明确声明监护身份并同意。此声明不等同于已完成法定身份认证；授权不得由模型或群消息代为作出。",
      "邀请照护者前请确认其照护职责；只有被明确授予范围的人能查看和记录，加入家庭微信群不会自动获得小程序访问权。可撤销照护者权限，群机器人也只能读取已开通的指定群。",
      "微信群采集为定时、被动处理，启用前须告知群成员并取得必要同意。只整理宝宝照护相关信息，不为闲聊建立用户画像。原文到期清理但必要结构化照护记录继续保留，内容不清楚时只在程序内追问。",
    ] },
    { title: "第三方处理与图片", paragraphs: [
      `AI 接收方：${config.modelName || "待配置"}；处理地域：${config.modelRegion || "待核实"}；政策：${config.modelPolicy || "待配置"}。你开启 AI 后，当前消息、必要记录上下文和最近对话交由该服务整理；照片还需单独开启图片处理。供应商侧留存依其政策及实际服务约定，不承诺代其立即删除。`,
      "图片由你主动选择，上传后校验格式和尺寸、移除定位等 EXIF 元数据，保存于私有空间；每次读取校验宝宝授权，不公开存储地址或长期分享链接。图片只能辅助描述可见现象，不作疾病诊断。",
      "微信能力由腾讯提供，只有主动选择图片或使用语音时请求相应能力。语音识别结果先进入可编辑草稿，发送后才交给服务；未配置和披露语音供应商前不开放语音。",
    ] },
    { title: "服务说明与 AI 标识", paragraphs: [
      "内置助手为 AI，整理和回复可能出错；AI 回复持续标识，复制或导出时保留来源标识。用户的原文、照片和实际照护事实不会被标成 AI 生成。记录保存状态以服务器回执为准。",
      "本产品不是医疗器械、诊断工具或急救监护系统，不持续监控宝宝。没有记录不等于没有喂养、排泄或睡眠。明确的危险描述会提示及时寻求现实帮助；照片判断、模型回复、后台人工和定时采集均不能替代急救。",
      "当前免费体验，微信支付关闭。可以在菜单提交问题、投诉或隐私请求并查询进度；运营只在授权范围、说明理由并留审计后查看必要内容。",
    ] },
  ];
  const version = `2026-10-24.${createHash("sha256").update(JSON.stringify(documents)).digest("hex").slice(0, 16)}`;
  return { version, ready, contact: config.contact, documents, retention: { chatDays: config.chatDays, backupDays: config.backupDays, orphanHours: config.orphanHours, responseDays: config.responseDays } };
}
