import type { FeaturedProduct } from "@/lib/content/types";

// Static fallback for the one public 近邻互助组 record. Payload can replace the copy,
// but every public consumer resolves through the same contract so identity, stage, and
// canonical actions cannot drift between the homepage answer and the formal page.
export const neighborsProduct = {
  slug: "neighbors",
  canonicalUrl: "https://www.codeforpeople.cn/neighbors",
  name: "近邻互助组",
  organizationRole: "码成仝是组织与母品牌",
  brandRelationship: "码成仝当前唯一的旗舰产品",
  audience: "面向希望在原有邻里关系中提出具体求助、分享亲历经验并共同确认下一步的人",
  exploration:
    "它探索怎样让邻里把自己亲历过的服务经验带回真实关系场，由 AI 协助整理和连接",
  humanResponsibility: "由真人提供事实并承担关键承诺",
  discoveryQuestion: {
    label: "近邻互助组是什么？",
    value: "近邻互助组是什么？",
  },
  stage: {
    label: "交互原型",
    dataBoundary: "不接真实业务数据",
    serviceBoundary: "不代表服务已经上线",
  },
  primaryAction: {
    label: "体验近邻互助组（原型）",
    href: "https://ideal.codeforpeople.cn/",
    description: "进入公开原型地图；在新标签页打开。",
  },
  secondaryAction: {
    label: "查看正式介绍",
    href: "/neighbors",
    description: "回到主站阅读稳定、可引用的产品说明。",
  },
  implementationAction: {
    label: "查看实施对照",
    href: "https://ideal.codeforpeople.cn/neighbors/prototype-implementation/",
    description: "面向协作者的次级工程材料，用于理解角色、状态与 User Story。",
  },
  motivation: {
    heading: "让选择少受平台排序支配",
    summary:
      "近邻互助组试图减少广告排序、陌生评分和平台抽成对邻里选择的支配。这里先说明产品动机，完整立场由《数据平权宣言》承载。",
  },
  prototype: {
    heading: "原型演示一条怎样的互助路径",
    summary:
      "它从关系场中的具体求助开始，经过亲历分享、证据判断和 AI 协助整理，回到一次由真人确认的行动。这是一条待验证的机制，不是已经运行的服务流程。",
    steps: [
      {
        title: "从关系场提出求助",
        body: "以邻里关系中的具体生活问题作为演示起点，先讲清处境，再判断需要什么帮助。",
        responsibility: "neighbor",
      },
      {
        title: "分享亲历与依据",
        body: "邻里分享自己亲历过的服务经验，并区分事实、观察和仍需确认的信息。",
        responsibility: "neighbor",
      },
      {
        title: "AI 协助整理和连接",
        body: "AI 只协助整理线索和建立连接，不替代亲历者提供事实，也不替任何人作出承诺。",
        responsibility: "ai",
      },
      {
        title: "由真人确认行动",
        body: "关键事实与承诺由真人再次确认，原型才展示一次可能的下一步。",
        responsibility: "human",
      },
    ],
  },
  boundaries: {
    heading: "现在公开的是待验证机制",
    summary:
      "当前公开内容用于理解和讨论产品方向，不能完成真实互助事务，也不能证明相关社区、服务或治理能力已经上线。",
    points: [
      "不接入真实业务数据，请勿输入真实个人资料或敏感信息。",
      "没有证据表明真实用户、服务者网络、交易、预约或付款能力已经运行。",
      "AI 不提供已验证推荐；关键事实、证据和承诺仍需要真人确认。",
      "原型中的人物、价格、次数、月卡、证据等级和服务结果均为演示内容。",
      "数据治理与 Agent 协作展示的是待验证设想，不代表制度或服务已经投入运行。",
    ],
  },
  relatedReading: [
    {
      label: "为什么做",
      href: "/manifesto",
      description: "阅读《数据平权宣言》，理解为什么要减少平台租金和数据占有对普通人的支配。",
    },
    {
      label: "如何选题",
      href: "/wam",
      description: "浏览《牛马能力剥夺矩阵》，理解这项探索如何放进更大的能力缺口检查框架。",
    },
    {
      label: "如何约束",
      href: "/license",
      description: "阅读《牛马互助协议》，了解组织如何公开价格、资金、分配和修正边界。",
    },
  ],
  sceneExplorations: [
    {
      label: "街坊味",
      href: "https://ideal.codeforpeople.cn/%E8%A1%97%E5%9D%8A%E5%91%B3/",
      description: "围绕邻里饮食与协作的场景探索原型，不是独立旗舰产品。",
    },
    {
      label: "楼道收一收",
      href: "https://ideal.codeforpeople.cn/%E6%A5%BC%E9%81%93%E5%9B%9E%E6%94%B6%E6%8F%90%E9%86%92/",
      description: "围绕楼道公共空间与回收提醒的场景探索原型，不代表服务已经上线。",
    },
  ],
} satisfies FeaturedProduct;
