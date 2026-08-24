import type { NeighborsPageContent } from "@/lib/content/types";

// Product identity and destinations are code-owned. The visitor-facing narrative below
// is mirrored into structured Payload fields and is used whole as the safe fallback when
// the CMS record is missing or incomplete.
export const neighborsIdentity = {
  slug: "neighbors",
  name: "近邻互助组",
  canonicalUrl: "https://www.codeforpeople.cn/neighbors",
  prototypeUrl: "https://ideal.codeforpeople.cn/",
} as const;

export const neighborsPage = {
  hero: {
    stageLabel: "正在设计中的小程序",
    eyebrow: "码成仝 · 近邻互助组",
    tagline: "找靠谱的人，先问亲自用过的人。",
    summary:
      "近邻互助组是一款正在设计中的小程序。消费者分享自己亲自购买或使用服务的经历，帮助身边的人少踩坑、找到更合适的服务者。",
    distinction: "它不做广告榜，不靠陌生人的星级，也不把推荐变成生意。",
    affiliation: "由码成仝发起。",
  },
  cta: {
    label: "打开体验原型",
    description: "目前开放的是交互原型，不会产生真实预约或交易。",
  },
  howItWorks: {
    heading: "求助留在熟悉的地方，亲历回到原来的关系里",
    intro: "在原型里，一次互助从原有的邻里关系开始，不要求求助者先搬到新平台。",
    items: [
      {
        title: "求助留在原来的群里",
        body: "你仍然可以在邻居群、业主群或熟人群里提出需要，不必先去一个新平台重新发帖。",
      },
      {
        title: "亲自用过的人回应",
        body: "亲自用过相关服务的人，可以把自己的经历整理成一张亲历卡，分享回原来的对话。",
      },
      {
        title: "把判断依据说清楚",
        body: "点开卡片后，你会看到这是谁的经历、用过几次、最近一次是什么时候，以及哪些事实与你这次的需要有关。",
      },
      {
        title: "由你自己决定",
        body: "看完这些信息，再由你自己决定要不要继续联系服务者。",
      },
    ],
  },
  evidence: {
    heading: "不是一句“靠谱”，而是足够你自己判断的信息",
    intro: "一张亲历卡不是平台的质量担保，而是帮助你少一点盲猜、多一点依据。",
    items: [
      {
        title: "来自亲自用过的人",
        body: "一段亲历必须来自亲自购买或使用过服务的人。",
      },
      {
        title: "说明经历发生过什么",
        body: "它会说明推荐人与服务者的关系、使用次数、最近时间，以及哪些内容已经确认。",
      },
      {
        title: "只证明自己知道的部分",
        body: "亲历者只分享自己知道的部分，不替服务者作保证。",
      },
      {
        title: "不靠推荐获利",
        body: "亲历者没有推荐佣金，也不会因为推荐得多而获得排名或推广特权。",
      },
    ],
  },
  nonGoals: {
    heading: "不把互助重新做成广告平台",
    intro: "近邻互助组首先服务消费者之间的互助，不以替服务者获客为中心。",
    items: [
      {
        title: "不是商家排行榜",
        body: "近邻互助组不是商家排行榜，也不是陌生人评分网站。",
      },
      {
        title: "不出售排序位置",
        body: "它不替服务者购买流量，也不接受付费排名。",
      },
      {
        title: "不把关系变成获客渠道",
        body: "它不鼓励无目标地群发推荐卡，也不把邻里关系变成获客渠道。",
      },
      {
        title: "不作无限担保",
        body: "它不会因为有人分享过一次经历，就宣称某个服务者永远可靠。每次选择仍然由消费者结合实际情况判断。",
      },
    ],
  },
  responsibility: {
    heading: "工具可以帮忙，责任不能交出去",
    intro: "智能助手可以提高整理和沟通的效率，但不能成为任何人的责任替身。",
    items: [
      {
        title: "帮助整理与说明",
        body: "智能助手可以帮助整理需求、标明信息来源，或者依据服务者确认过的内容回答问题。",
      },
      {
        title: "不能冒充真人",
        body: "它不能冒充真人，也不能替服务者接单、报价或承诺时间。",
      },
      {
        title: "关键决定由人确认",
        body: "涉及价格、时间、临时变更和最终服务承诺，必须由服务者本人确认。",
      },
      {
        title: "每句话都标明身份",
        body: "页面中的每句话都应该让人看得出，它来自消费者、服务者本人，还是智能助手。",
      },
    ],
  },
  dataPrinciples: {
    heading: "你的经历，仍然由你决定怎样分享",
    intro: "消费者拥有自己的亲历和关系，不需要用放弃隐私来换取帮助。",
    items: [
      {
        title: "默认不公开",
        body: "亲历、评价和联系方式默认不公开，由本人决定分享什么、分享给谁。",
      },
      {
        title: "确认不等于公开",
        body: "确认一次服务事实，不等于必须把它公开给其他人。",
      },
      {
        title: "可以带走和删除",
        body: "个人记录可以导出和删除；一次分享不应该带出与当前判断无关的私人信息。",
      },
      {
        title: "不出售关系和记录",
        body: "近邻互助组不出售消费记录、关系链或私人评价。",
      },
      {
        title: "用透明月卡支持运行",
        body: "如果产品正式运行，我们计划通过公开、透明的月卡支持它，而不是靠广告和出售数据维持。",
      },
    ],
  },
  network: {
    heading: "一次经历，也可以成为下一次互助",
    intro: "消费者既可以从别人的亲历中获得帮助，也可以把自己的经历留给后来的人。",
    items: [
      {
        title: "保存自己的经历",
        body: "服务完成后，消费者可以保存这次经历，并决定是否把它公开为亲历卡。",
      },
      {
        title: "在需要时帮助别人",
        body: "下次身边有人遇到相似的问题，这段经历就能帮他多一个有根据的选择。",
      },
      {
        title: "互助可以继续流动",
        body: "每个人既可以从别人的亲历中获得帮助，也可以把自己的经历留给后来的人。",
      },
      {
        title: "形成消费者亲历网络",
        body: "这样积累起来的不是广告位和排行榜，而是由消费者共同形成的亲历网络。",
      },
    ],
  },
  prototype: {
    eyebrow: "公开体验原型",
    heading: "先看看一次邻里互助怎样发生",
    intro:
      "目前开放的是一套使用示例人物和示例数据制作的交互原型。它展示一条邻里求助怎样经过亲历分享，变成一次更有根据的选择。",
    notice: "原型不会产生真实预约、付款或服务承诺，也不接入真实业务数据。请勿填写真实个人资料。",
  },
  relatedReading: {
    heading: "继续了解码成仝为什么这样做",
    intro: "近邻互助组是一项具体的产品探索；这些公开文本说明它背后的立场、选题方法和自我约束。",
    items: [
      {
        label: "为什么做",
        description: "阅读《数据平权宣言》，了解为什么软件和数据的红利应该更多回到普通人手中。",
        target: "manifesto",
      },
      {
        label: "如何选题",
        description: "浏览《牛马能力剥夺矩阵》，了解码成仝怎样从真实处境判断值得做的方向。",
        target: "map",
      },
      {
        label: "如何约束",
        description: "阅读《牛马互助协议》，了解组织怎样公开价格、资金、分配和修正边界。",
        target: "license",
      },
    ],
  },
} satisfies NeighborsPageContent;
