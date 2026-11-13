# 微信登录与年龄核验：官方接口核实

核实日期：2026-10-13。本文是本次实现依据及接入边界，不是供应商已开通或真实联调成功的证明。仅使用微信、腾讯云及国家网信办的一手资料；未读取凭证、提交真实身份资料、申请服务或修改任何线上配置。

## 本次选择

推荐第二层采用腾讯云 `MinorsVerification` 的姓名＋身份证路径（`Type: "1"`）。接口直接给出成年/未成年结果，输入不要求证件照片。产品应称为“身份资料年龄核验”，并说明不包含本人活体核验；服务端将结果绑定当前微信身份，但这项绑定不能证明操作者就是证件本人。第一层的年龄申报与第二层结果分开保存，第三层追加核验仅预留状态和接口。[年龄核验接口](https://cloud.tencent.com/document/api/1007/39766)

本次不采用手机号路径（`Type: "0"`）：其覆盖受腾讯健康守护模型数据限制，查无结果不表示用户的手机号没有运营商实名，更不能把手机授权或模型判断当作操作者的实名实证。[年龄核验接口](https://cloud.tencent.com/document/api/1007/39766)

## 微信登录与隐私交互

- 小程序通过 `wx.login` 获取一次性 `code`，后端调用 `GET https://api.weixin.qq.com/sns/jscode2session`，参数为 `appid`、`secret`、`js_code`、`grant_type=authorization_code`。后端据返回的 `openid` 建立自身登录态；`unionid` 仅在适用条件满足时返回。接口不返回年龄、生日或证件实名结果，`session_key` 不得下发客户端。[登录流程](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)、[code2Session](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session.html)
- 微信侧应先在小程序管理后台声明真实处理的数据；已声明的隐私接口仍须用户完成平台隐私授权。自定义引导通过 `open-type="agreePrivacyAuthorization"` 及其同意事件同步用户操作，不能程序调用一个“同意”状态绕开平台交互。隐私指引可用 `wx.openPrivacyContract` 打开。[微信隐私开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html)
- `wx.getPrivacySetting` 的 `needAuthorization=false` 也可能源于后台没有声明隐私类型；它不证明已经取得本业务的姓名/身份证单独同意。`privacyContractName` 是平台配置的协议名称。[getPrivacySetting](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/privacy/wx.getPrivacySetting.html)
- `wx.requirePrivacyAuthorize` 可在真实隐私接口调用前触发授权流程。已授权时立即成功，拒绝时失败；该 API 与 `getPrivacySetting` 自基础库 2.32.3 起支持，原生接口采用回调，不支持原生 Promise 调用。调用方可自行封装 Promise；缺失 API 不应视为同意。[requirePrivacyAuthorize](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/privacy/wx.requirePrivacyAuthorize.html)

实现建议：首次打开显示统一引导，但只有明确点击后开始身份和年龄提交。恢复有效业务登录态、隐私同意版本及服务端有效年龄结果时不重复填写；平台要求重新同意、业务告知发生实质变化或结果过期时分别处理。微信登录成功不等于年龄核验成功。

## 腾讯云适配契约

### 请求

| 项目 | 值 |
| --- | --- |
| 服务域名 | `faceid.tencentcloudapi.com` |
| Action / Version | `MinorsVerification` / `2018-03-01` |
| Region | 本接口不需要传递 |
| 本次业务参数 | `Type: "1"`、`Name`、`IdCard`，均为字符串 |
| 不采用的路径 | `Type: "0"`＋11位 `Mobile` |
| 可选字段 | `Encryption` 为供应商另行定义的敏感字段加密结构，不能自行发明格式 |
| 默认接口限频 | 20 次/秒；应用仍需更低的账号级限频及并发防护 |

参数以官方 [API 文档](https://cloud.tencent.com/document/api/1007/39766) 及 [官方 Node SDK 类型](https://raw.githubusercontent.com/TencentCloud/tencentcloud-sdk-nodejs/master/src/services/faceid/v20180301/faceid_models.ts) 为准。

推荐服务器采用 HTTPS `POST /` 与 JSON body，不采用文档示例中的敏感字段 URL query。腾讯云推荐 TC3 签名，公共参数放请求头：`X-TC-Action`、`X-TC-Version`、`X-TC-Timestamp`、`Authorization`；使用临时凭证时另有 `X-TC-Token`，长期凭证不得设置该 Token。签名 scope 的 service 是 `faceid`，日期取请求时间戳对应的 UTC 日；超过 5 分钟时差会签名过期。[公共参数](https://cloud.tencent.com/document/api/1007/31323)

若自行实现 TC3：签名至少包含 `content-type;host`，可再签 `x-tc-action`；规范头名和值转小写并按头名排序，JSON 的实际字节必须与所签 body 相同。服务端应固定官方域名，禁止客户端传供应商 URL。日志不可复制官方演示代码打印 canonical request、请求体或 Authorization 的做法。[签名方法 v3](https://cloud.tencent.com/document/api/1007/31324)

### 响应与内部映射

供应商响应为 `Response` 包装，业务字段是字符串 `Result`、`Description`、`AgeRange`、`RequestId`。仅按 `Result` 和可识别的区间处理，不根据中文描述推断。

| `Result` | 官方语义概括 | 建议业务状态 |
| --- | --- | --- |
| `"0"` | 成年 | `adult`，验证区间一致性后启用适用能力 |
| `"-1"` | 未成年 | `minor`，进入既定保护/限制路径 |
| `"-2"` | 手机数据没有匹配 | `unknown`；本次姓名路径出现时也不能放行 |
| `"-3"` | 姓名与证件不匹配 | `failed`，允许更正/申诉 |
| `"-4"` / `"-5"` | 证件/姓名输入非法 | `failed`，提示检查输入 |
| `"-6"` / `"-8"` | 数据源异常/升级 | `unavailable`，稍后主动重试 |
| `"-7"` | 身份数据没有匹配 | `unknown`，帮助/申诉 |
| 未知码、缺字段、矛盾组合 | 无可靠结论 | `unknown` 或 `review_required` |

供应商年龄区间只有 `[0,8)`、`[8,16)`、`[16,18)`、`[18,+)`；没有精确年龄、生日或 14 岁分界。区间文案对末项写“大于18”，而接口总述是“年满18”且码值表示成年，故不要从该处文字另创 19 岁规则。`[8,16)` 绝不能换名为“14–15岁”。`0/-1/-3` 为计费结果，重试不得无边界循环。[官方结果定义](https://cloud.tencent.com/document/api/1007/39766)

上表内部状态、异常矛盾的处理和限频方案是本项目实现建议，不是供应商状态名称。供应商异常 `Response.Error` 与业务 `Result` 分开解析：未开通、欠费、账号未实名、签名失败、网络超时均不得产生成年记录。不要将原始 `Description`/错误对象直接记录或回显，输出固定的可理解提示。

### 同步接口与第三层

`MinorsVerification` 是一次请求直接得到结论的接口。公开契约未提供回调地址、异步 token 或凭 `RequestId` 重新查询年龄结果的 API；因此本次的状态查询应读取业务端已持久化的最小结果，不新建一个可由客户端声称“核验成功”的供应商回调入口。`RequestId` 用于排查，不能作为另一个账号认领结果的凭证。[官方 API](https://cloud.tencent.com/document/api/1007/39766)、[官方 SDK 客户端](https://github.com/TencentCloud/tencentcloud-sdk-java/blob/master/src/main/java/com/tencentcloudapi/faceid/v20180301/FaceidClient.java)

第三层若以后采用活体核身，才涉及 `DetectAuth` / `BizToken`、核身流程与服务端取回结果。不能混用这些流程 token 和当前同步年龄接口。微信原生人脸核身另有类目、资质及开通条件，不因普通 API 可调用就自动获得资格。[基础版接入](https://cloud.tencent.com/document/product/1007/56811)、[增强版接入](https://cloud.tencent.com/document/product/1007/56812)

## 是否改用二要素认证接口

腾讯云另有 `IdCardVerification`，同一服务及版本，输入姓名、身份证，不需要照片；但输出仅说明二者是否匹配，**不返回年龄或年龄区间**。它的 `Result="0"` 是匹配成功，`"-1"` 是不匹配，不能复用年龄接口的错误码映射。[二要素认证](https://cloud.tencent.com/document/api/1007/33188)

因此仅需18岁边界时，`MinorsVerification Type="1"` 更直接。若将来确需14岁边界，可以另行评估“二要素核验成功后由后端从经核验的适用证件计算必要年龄段”，但需确认接受的证件类型、边界日期和业务必要性；未核验的身份证格式/生日本身仍不是权威结果。这是候选设计，不是本次现成能力，也不解决证件冒用。

## 隐私与状态保存建议

《个人信息保护法》要求最小必要、敏感信息的单独同意及必要性/影响告知；不满14周岁个人信息需监护人同意和专门规则。委托处理应明确双方责任；敏感信息及委托处理等适用情形还需事前影响评估。年龄限制并不替代这些义务。[个人信息保护法，第6、21、28–31、55–56条](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)

建议本次遵循以下边界：

1. 先取得必要的年龄申报/告知；已申报未满14岁时，不以本人普通勾选代替监护人同意并继续收集证件。`[8,16)` 结果也不能推出已经满足14岁边界。现有监护流程尚未完成时，提供清晰分流、隐私政策、帮助及申诉。
2. 姓名和证件仅由用户主动提交，经后端短暂处理后发给明确告知的受托方；不进 Payload、聊天记录、模型上下文、访问日志、错误追踪、埋点或客户端长期 storage。请求正文避免自动审计采集，失败时不回显原始身份字段。
3. 只持久化内部用户 ID、成年/未成年/未知、供应商原有必要区间、来源/API/核验强度、`RequestId`、时间、业务有效期和同意版本。不保存完整供应商响应。供应商没有给定结果有效期；任何 TTL 都是业务策略，不能写成官方有效期。
4. 使用服务端当前会话创建一次性尝试 ID，原子占用/完成并限制并发；客户端不得指定 owner、openid、结果或另一个账号的 RequestId。重试生成新尝试；网络结果不明须保持未核验。身份迁移必须验证旧匿名凭证所有权，不能只用可猜的 session/user ID 认领记录。
5. 所有适用的生成、上传、外部连接入口在后端检查结果和有效期；拒绝、取消、未知、服务故障和追加核验状态不默认成年。隐私、权利请求和反馈入口不应因年龄引导被隐藏。上述为实施建议，不声称完整未成年人保护已建成。

## 开通与待配置事项

腾讯云通用指南要求企业实名认证及人脸核身服务开通，PaaS API 与微信原生核身 UI 的开通路径不同。公开资料没有为本业务承诺审核结果、持续可用性或免费的生产额度；正式接入需在控制台确认 `MinorsVerification` 当前账户权限、计费与适用场景。不要因为错误码表列有“未开通”就假定所有账号已可用。[通用限制](https://cloud.tencent.com/document/product/1007/45893)、[流程指引](https://cloud.tencent.com/document/product/1007/30999)

最少外部事项：

- 用户自行在受控环境配置真实小程序 AppID/AppSecret、合法请求域名和微信后台隐私保护指引；不把密钥发到聊天。
- 企业账号自行开通腾讯云人脸核身 API，确认姓名＋证件年龄查询权限、受托处理约定、必要的告知及留存安排，并为服务端配置最小权限凭证。未开通或缺凭证时明确显示服务未就绪。
- 发布前用取得适当同意的真实测试场景进行供应商联调及微信真机授权验收。合成响应测试只证明应用映射、拦截与隔离，不证明权威核验成功。

本次不需要要求用户采购人脸 UI、上传身份证照片或开通强制刷脸；若以后追加第三层，再单独验证其必要性与平台资格。

## 本次阅读说明

微信官方页面在网页检索工具中出现读取错误，随后从同一官方 URL 通过 HTTPS 获取并阅读正文，确认了当前登录参数和隐私 API 行为；未用第三方转载替代证据。本文未作生产账户权限检查，因此“文档存在”与“本账号已经可调用”必须保持区分。
