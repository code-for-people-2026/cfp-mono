import type { Where } from "payload";

export const operationLabels: Record<string, string> = {
  pending: "待受理", in_progress: "处理中", review: "待复核", resolved: "已处置",
  reject: "拒绝未生成请求",
  urgent: "紧急", high: "高", normal: "普通", complaint: "用户举报", appeal: "用户申诉",
  moderation: "自动审核", image: "图片审核", input: "输入", output: "输出", user_report: "用户报告",
  input_image: "图片输入", output_image: "图片输出", violence: "暴力", self_harm: "自伤相关",
  sexual: "色情", hate: "歧视与仇恨", privacy: "隐私", fraud: "诈骗违法", harassment: "骚扰", other: "其他",
};
export const options = (values: string[]) => values.map((value) => ({ value, label: operationLabels[value] || value }));
export const recordURL = (slug: string, id?: number | string, admin = "/admin") =>
  `${admin}/collections/${slug}${id == null ? "" : `/${encodeURIComponent(String(id))}`}`;

// Use Payload's native query parameters so pagination, filters and saved columns stay native.
export function collectionURL(slug: string, where: Where, admin = "/admin") {
  const params = new URLSearchParams();
  function add(value: unknown, key: string) {
    if (value && typeof value === "object") {
      for (const [child, item] of Object.entries(value)) add(item, `${key}[${child}]`);
    } else params.set(key, String(value));
  }
  add(where, "where");
  return `${recordURL(slug, undefined, admin)}?${params}`;
}

export function caseQueueFilters(userId: number | string, now = new Date()): Record<"pending" | "mine" | "overdue", Where> {
  return {
    pending: { status: { equals: "pending" } },
    mine: { assignedTo: { equals: userId } },
    overdue: { or: [
      { and: [{ acceptedAt: { exists: false } }, { acceptBy: { less_than: now.toISOString() } }] },
      { and: [{ status: { not_equals: "resolved" } }, { resolveBy: { less_than: now.toISOString() } }] },
      { and: [{ feedbackAt: { exists: false } }, { feedbackBy: { less_than: now.toISOString() } }] },
    ] },
  };
}
