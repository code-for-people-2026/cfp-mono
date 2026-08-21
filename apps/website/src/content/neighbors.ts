import type { FeaturedProduct } from "@/lib/content/types";

// The one public fact record for 近邻互助组. The future /neighbors page should reuse
// this record rather than restating the product identity, stage, or canonical routes.
export const neighborsProduct = {
  slug: "neighbors",
  name: "近邻互助组",
  brandRelationship: "码成仝当前唯一的旗舰产品",
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
    href: "https://ideal.codeforpeople.cn/neighbors/prototype-customer/",
  },
  secondaryAction: {
    label: "查看正式介绍",
    href: "/neighbors",
  },
} satisfies FeaturedProduct;
