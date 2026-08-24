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

export const neighborsDiscoveryQuestion = {
  label: "近邻互助组是什么？",
  value: "近邻互助组是什么？",
} as const;

export const neighborsPage = {
  hero: {
    stageLabel: "交互原型",
    eyebrow: "码成仝 · 正在设计",
    tagline: "想找靠谱的服务，先问问真正用过的人。",
    summary:
      "近邻互助组帮助你把自己实际用过服务的经历分享给身边人，让他们少踩坑，也更容易找到合适的服务者。",
    distinction: "把真实经历说清楚，把最后的决定留给你。",
    affiliation: "码成仝正在把它做成一款小程序。",
  },
  cta: {
    label: "看看体验原型",
    description:
      "这是演示原型，不能真的预约或交易，请不要填写真实姓名、电话等个人信息。",
  },
  howItWorks: {
    heading: "不用换平台，在原来的群里就能互相帮忙",
    intro:
      "比如家里水管漏了，你照常在业主群里问一句。真正找过附近师傅的人，可以发来一张亲历卡，告诉你他用过几次、最近一次是什么时候。看完这些信息，再由你决定要不要联系。",
    items: [
      {
        title: "照常在群里问",
        body: "有需要时，继续在邻居群、业主群或熟人群里问一句，不用换地方发帖。",
      },
      {
        title: "收到一张亲历卡",
        body: "真正用过这项服务的人，可以把关键信息整理成亲历卡，直接发回群里。",
      },
      {
        title: "看清信息再决定",
        body: "点开卡片，看看是谁分享的、实际用过几次、最近一次是什么时候，再决定要不要联系服务者。",
      },
    ],
  },
  evidence: {
    heading: "亲历卡不只说“靠谱”，还告诉你为什么",
    intro: "它把一次真实经历里最有用的信息放在一起，方便你判断是否适合自己的情况。",
    items: [
      {
        title: "分享者自己用过",
        body: "只有真正买过或用过这项服务的人，才能分享这段经历。",
      },
      {
        title: "说清具体发生了什么",
        body: "卡片会写明分享者和服务者是什么关系、实际用过几次、最近一次是什么时候。",
      },
      {
        title: "标明哪些信息已经确认",
        body: "用户分享、服务者确认和 AI 整理的内容会分开标明，让人一眼看出来源。",
      },
      {
        title: "一次经历只代表那一次",
        body: "别人用得满意，只能说明当时的情况。你这次要不要联系，还要结合自己的需要判断。",
      },
    ],
  },
  responsibility: {
    heading: "三件事，让这份参考更可信",
    intro: "分享经历的人、服务者和 AI 助手，各自只对自己能确认的部分负责。",
    items: [
      {
        title: "分享不拿佣金",
        body: "这里没有付费排名。有人求助时再分享经历，分享的人不会因为推荐而拿到佣金。",
      },
      {
        title: "AI 只帮忙整理",
        body: "AI 可以整理需求、标明信息来源，但不能替服务者接单、报价或承诺时间。",
      },
      {
        title: "自己的经历，自己决定怎么分享",
        body: "这些是我们准备遵守的数据原则：亲历、评价和联系方式默认不公开；要不要分享、分享给谁，由你决定。正式产品计划支持导出或删除自己的记录。",
      },
    ],
    example: {
      heading: "一张亲历卡会把信息来源分开标明",
      request: "邻居问：家里水管漏了，附近有没有找过的师傅？",
      items: [
        {
          title: "用户分享",
          body: "去年和今年各找过李师傅一次。最近一次是上个月，处理的是厨房水管漏水。",
        },
        {
          title: "服务者确认",
          body: "李师傅确认：这两次服务由本人完成。价格和上门时间需要每次单独确认。",
        },
        {
          title: "AI 整理",
          body: "已整理使用次数、最近时间和服务内容；没有替双方作出价格或质量承诺。",
        },
      ],
    },
  },
  prototype: {
    eyebrow: "演示原型",
    heading: "现在可以走一遍完整流程",
    intro:
      "原型中的人物和数据都是虚构的。你可以看看一次求助怎样收到亲历卡，再决定是否联系服务者。",
    notice:
      "原型不能真的预约、付款或接单，也不会读取真实业务数据。请不要填写真实姓名、电话等个人信息。",
  },
  relatedReading: {
    heading: "还想知道我们为什么这样做？",
    intro: "可以继续看下面三篇说明，了解码成仝为什么做、怎样选题，以及拿什么约束自己。",
    items: [
      {
        label: "为什么做",
        description: "看看我们为什么希望普通人能真正从软件和数据中受益。",
        target: "manifesto",
      },
      {
        label: "如何选题",
        description: "看看我们怎样从日常生活里的真实困难出发，判断一个问题值不值得做。",
        target: "map",
      },
      {
        label: "如何约束",
        description: "看看我们怎样公开价格、资金去向和分配规则，并在做错时及时修正。",
        target: "license",
      },
    ],
  },
} satisfies NeighborsPageContent;
