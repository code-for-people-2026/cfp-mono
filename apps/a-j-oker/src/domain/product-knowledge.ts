/** Versioned product facts shared by fixed replies and the model; never user settings. */
const PRODUCT_KNOWLEDGE_VERSION = "aj-product-help-v2";
export const DATA_HELP = "本小程序的删除入口是“设置→隐私与数据→删除数据”，可先通过“导出数据”保存副本，再确认“删除我的全部在线数据”。删除范围包含该身份的在线对话、摘要、练习、图片、微信绑定、年龄核验与凭证；不会删除你设备上其他文件或已经自行导出的副本。安全处置证据、日志和备份按隐私政策另行处理，不能承诺立即全部抹除。我没有替你执行删除。";
export const DATA_TARGET_CLARIFICATION = "你想删除的是本小程序保存的聊天和个人资料，还是手机、电脑或其他应用里的资料？请先确认对象；我还没有执行任何删除。";
export const PRODUCT_DELETE_CLARIFICATION = "你说的是本小程序的删除功能。想了解的是删除聊天和个人资料，还是从微信中移除小程序入口？如果是别的内容，请说明想删除什么、目前看到哪个页面；我会先问清楚，再说明相应步骤。我还没有执行删除。";
export function needsProductDeleteClarification(text: string) {
  return /(?:本|这个|当前|你们的?)小程序|本产品|这个应用/.test(text)
    && /删除|清除|删掉/.test(text)
    && !/聊天|个人资料|我的资料|我的数据|自己的数据|我自己的数据|账号数据|全部数据|在线数据|微信中|微信里|微信的|手机桌面|服务器|部署|数据库|日志|他人/.test(text);
}
export const AGE_HELP = "不需要、也请不要在聊天里填写身份证号码。本产品仅向已完成成年核验的成年人开放聊天；成年核验在专门的核验页面进行，不能用微信登录或留空聊天资料代替。若你已核验成年，聊天时无需再次提供证件；未完成核验时可先查看隐私说明，或通过设置→帮助与反馈咨询。";
export const REMINDER_HELP = "你可以先普通聊天，不必登记紧急联系人。可选提醒、紧急联系人授权与连续使用满两小时的安全休息提醒是不同事项；安全时长提醒不能通过一句聊天关闭。我没有修改任何设置或联系人授权，已有授权需在设置中的对应入口自行查看或撤回。";
export const PRODUCT_KNOWLEDGE = `本产品使用知识（${PRODUCT_KNOWLEDGE_VERSION}，优先于角色想象）：
${AGE_HELP}
${DATA_HELP}
${DATA_TARGET_CLARIFICATION}
${PRODUCT_DELETE_CLARIFICATION}
${REMINDER_HELP}
微信里删除小程序入口不等于删除平台保存的数据。没有工具成功回执，不说已删除、已关闭提醒、已保存偏好、已通知或已撤回。没有帖子、评论或公开视频功能，不编造这些删除项目。不明确的设备、应用或数据对象先澄清；整理桌面可能指实体桌面或电脑桌面，不能替用户认定。已明确提到本小程序但操作对象仍模糊时，不要当作无关任务拒绝；先询问具体对象或当前页面，仍不明确时继续聚焦追问，明确后再给步骤。请求整理使用说明不等于授权实际删除，也不自动获得生图权限。产品知识未涵盖的操作坦诚不确定，指向设置→帮助与反馈，不编造菜单。普通删除资料需求不是自伤证据，独处、加班、家务也不能据此推断危机。`;

export function isDataHelpRequest(text: string) {
  return /(?:删除|清除|删掉)[^。！？\n]{0,22}(?:聊天|图片|记录|数据|资料)/.test(text) && /我|自己|个人|本小程序|这个小程序/.test(text) && /想|要|请|怎么|如何|哪里|告诉|范围|吗/.test(text)
    || /^你(?:已经|刚才)?(?:替我|帮我)(?:删(?:掉|除)?|清除)(?:所有|全部)?(?:聊天|图片|记录|数据)?(?:了|好了)吗[？?。\s]*$/.test(text.trim());
}
export function productHelp(text: string) {
  if (needsProductDeleteClarification(text)) return PRODUCT_DELETE_CLARIFICATION;
  if (isDataHelpRequest(text)) return /(?:本|这个|当前|你们的?)小程序|本产品|这个应用|这里|和你|你(?:已经|刚才)?(?:替我|帮我)|所有聊天|全部聊天/.test(text) ? DATA_HELP : DATA_TARGET_CLARIFICATION;
  if (/身份证|证件号|成年核验/.test(text) && /不想|不愿|不填|留空|跳过|还能|可不可以|需要|怎么|如何|必须/.test(text)) return AGE_HELP;
  if (/提醒/.test(text) && /不想|不开|关闭|关掉|不设置|不设|取消/.test(text)) return REMINDER_HELP;
}
