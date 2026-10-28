import Link from "next/link";
import type { BeforeListTableServerProps, UIFieldServerProps } from "payload";
import { activeRule, canAudit, canReview, isAdministrator } from "./policy";
import { imageReviewConfigured } from "./image-review";
import { OperationsService } from "./service";
import { feishuAlertStatus } from "./alerts";
import { caseQueueFilters, collectionURL, recordURL } from "./admin-presentation";
import { CaseActions, CreateOperation, JudgeEvaluation, RuleActions, RunEvaluation } from "./admin-actions";

export async function OperationsListTools({ collectionSlug: slug, user, payload }: BeforeListTableServerProps) {
  const admin = payload.config.routes.admin;
  if (slug === "safety-cases" && canReview(user) && user) {
    const config = await new OperationsService(payload).configuration();
    let coverage: string;
    try { const rule = await activeRule(payload); coverage = `${rule.mode === "all" ? "全量语境复核" : "关键词召回 · 存在漏检区间"}（${rule.version}）`; }
    catch { coverage = "规则与程序版本不一致，需管理员复核"; }
    const filters = caseQueueFilters(user.id);
    const alerts = await feishuAlertStatus(payload);
    return <div className="safety-list-tools">
      <p>运营安排：{config.configured ? "已配置" : "待配置值班、时限与正式留存依据"}。文本审核：{coverage}。图片像素审核：{imageReviewConfigured() ? "已配置接口，以实际调用为准" : "未配置，图片处理关闭"}。</p>
      <p>危机通知：{alerts.text}。请留意「飞书提醒」列；消息发送成功不等于案件已受理。</p>
      {/* A document navigation resets Payload's client query state when clearing filters. */}
      <nav aria-label="案件快捷筛选">
        <a href={recordURL(slug, undefined, admin)}>全部案件</a>
        <a href={collectionURL(slug, filters.pending, admin)}>待受理</a>
        <a href={collectionURL(slug, filters.mine, admin)}>由我负责</a>
        <a href={collectionURL(slug, filters.overdue, admin)}>仅超时</a>
      </nav><p>使用「过滤条件」选择严重程度、负责人、状态或日期；打开案件详情进行处理。</p>
    </div>;
  }
  if (slug === "safety-audit" && canAudit(user)) return <p>操作和证据访问记录只读。数据库和主机管理员仍可改写底层数据，当前不具备外部不可篡改存证。</p>;
  if (!isAdministrator(user)) return null;
  if (slug === "safety-rules") return <CreateOperation kind="rules" admin={admin} />;
  if (slug === "safety-settings") return <div><p>请填写实际值班与留存安排。受理、处置期限按新案件创建时的配置计算，反馈期限按完成处置时的配置计算。</p><CreateOperation kind="settings" admin={admin} /></div>;
  if (slug === "safety-evaluation-items") return <CreateOperation kind="items" admin={admin} />;
  if (slug === "safety-evaluations") return <div className="safety-list-tools"><p>运行、人工判定和整改复测分别留痕，未运行成功不能填写通过。</p><Link href="/api/operations/export" prefetch={false} download>导出评测报告（JSON）</Link></div>;
  if (["safety-releases", "safety-regressions"].includes(slug)) return <p>请打开<Link href={recordURL("safety-rules", undefined, admin)}>对应规则版本</Link>执行回归、发布或回退。</p>;
  return null;
}

export async function OperationsDocumentActions({ collectionSlug: slug, data, id, user, payload }: UIFieldServerProps) {
  if (!id) return null;
  const admin = payload.config.routes.admin;
  if (slug === "safety-cases" && canReview(user)) {
    // Pass metadata only. Evidence is fetched explicitly, with a reason and an audit.
    const row = { id: Number(id), revision: data.revision, status: data.status, assignedTo: data.assignedTo, turnId: data.turnId, mediaId: data.mediaId, legalHold: data.legalHold };
    return <CaseActions row={row} administrator={isAdministrator(user)} userId={user.id} />;
  }
  if (!isAdministrator(user)) return null;
  if (slug === "safety-rules") {
    // eslint-disable-next-line react-hooks/purity -- Server-only query; eligibility is evaluated at request time and rechecked by the publishing service.
    const regressions = (await payload.find({ collection: "safety-regressions", overrideAccess: false, user, depth: 0, limit: 100, sort: "-id", where: { and: [{ ruleId: { equals: id } }, { state: { equals: "passed" } }, { createdAt: { greater_than: new Date(Date.now() - 7 * 86400_000).toISOString() } }] } })).docs;
    return <RuleActions id={Number(id)} regressions={regressions.map((row) => ({ id: Number(row.id), createdAt: row.createdAt }))} admin={admin} />;
  }
  if (slug === "safety-evaluation-items") return <RunEvaluation itemId={Number(id)} admin={admin} />;
  if (slug === "safety-evaluations") return <>
    <Link href={recordURL("safety-evaluation-items", data.itemId, admin)}>查看对应题目与判定标准</Link>
    <JudgeEvaluation row={{ id: Number(id), state: data.state, judgment: data.judgment }} />
    <RunEvaluation itemId={Number(data.itemId)} parentId={Number(id)} admin={admin} />
  </>;
  if (["safety-regressions", "safety-releases"].includes(slug)) return <Link href={recordURL("safety-rules", data.ruleId, admin)}>打开关联规则版本，执行回归或发布</Link>;
  return null;
}
