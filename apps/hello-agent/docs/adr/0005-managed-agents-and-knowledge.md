# Payload 管理 Agent 配置，显式 seed 初始化，知识库按专家绑定

Agent 提示词和启停状态属于管理员维护的产品配置，保存于同一 Payload 的 `agent-configs`，不放入访客仓库。每个受支持的心理流派有一个唯一标识，主 Agent 使用保留的 coordinator 标识；管理员可以编辑完整提示词、启停和绑定知识库，主 Agent 不能停用或删除。增加新的流派标识仍需扩展共享回应协议。每轮开始读取配置快照，仅注册已启用的专家，修改从下一轮生效。执行记录保存配置 ID / 更新时间，通用安全和工具权限约束由代码附加，不受提示词编辑改变。

默认提示词只用于 `seedAgents`。新本地库的 db:init 与显式 db:seed 调用同一个 seed；正式部署在迁移后执行 db:seed。seed 按唯一标识补缺，不覆盖已有记录，不生成管理员、聊天样例、知识库或凭证；删除的默认流派在下次显式 seed 时会补回，长期停用应使用启用开关。普通请求不偷偷创建配置，漏做 seed 时生成与就绪检查明确失败。外部 MCP 的独立提示词仍由其版本契约提供，不向外部客户端暴露内部专家配置。

`knowledge-bases` 支持后台参考资料和腾讯 ima，只允许管理员维护。每位专家最多绑定两个启用的知识库；只有实际咨询该专家才读取。ima 通过固定官方地址的 search_knowledge 接口查询主 Agent 提供的短方法关键词，取最多三个结果和正文片段；标题匹配没有正文时不伪称读过全文，也不宣称向量检索或获取了完整文档。资料、提示中的例子和搜索结果是参考素材，不能变更系统权限。连接失败给专家明确的缺失说明，可以继续普通支持性回应。

ima Client ID 与知识库 ID 可编辑；API Key 通过虚拟输入字段更新，以服务端 Payload secret 派生密钥进行 AES-256-GCM 加密。密文只对内部读取上下文可见，管理员接口也不回显；空白输入保留密钥，清除操作显式执行。不启用知识库版本历史，避免另外保存凭证副本；更换 Payload secret 前需要解密迁移或重新录入 ima 密钥。请求禁止重定向、固定 HTTPS 主机、8 秒超时、1 MB 响应上限；供应商异常原文不进入日志或模型上下文。数据库备份仍按私密数据保护。

官方协议依据：腾讯发布的 [ima 技能包 1.1.2](https://app-dl.ima.qq.com/skills/ima-skills-1.1.2.zip) 中 knowledge-base/references/api.md；配置入口为 [ima OpenAPI](https://ima.qq.com/agent-interface)。连接检查使用 get_knowledge_base 验证所填 ID 的读取权限；搜索使用 retcode/data/info_list/highlight_content 返回结构。自动测试使用符合此契约的 HTTP 边界夹具；没有真实 ima 凭证时不把夹具通过称为已连通用户的知识库。
