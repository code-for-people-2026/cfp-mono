import type { PayloadRequest } from "payload";
import { AppError } from "../contracts";
import type { IdentityService, Principal } from "../identity";
import { hash } from "../records/persistence";
import { appendOpsAudit } from "../operations/audit";
import { opsReason, opsRequestId, type MembershipOperations } from "../operations/contracts";
import { membershipCommandSchema, membershipPolicySchema, membershipStatus, defaultMembershipPolicy } from "./contracts";
import { MembershipRepository, type MembershipState } from "./persistence";

const unavailable = () => new AppError(503, "MEMBERSHIP_UNAVAILABLE", "暂时无法读取服务状态，请稍后重试。", true);
export class MembershipService implements MembershipOperations {
  readonly schema = membershipCommandSchema;
  readonly repo: MembershipRepository;
  constructor(readonly identity: IdentityService) { this.repo = new MembershipRepository(identity.store); }
  private async state(babyId: string, req: PayloadRequest): Promise<MembershipState> {
    try { return await this.repo.state(babyId, req) || { version: 0, policy: { ...defaultMembershipPolicy } }; }
    catch { throw unavailable(); }
  }
  async status(principal: Principal, babyId: string) {
    return this.identity.executeAuthorized(principal, babyId, "records:read", async (_scope, req) => {
      const state = await this.state(babyId, req);
      return membershipStatus(babyId, state.version, state.policy, this.identity.now());
    }, principal.kind === "collector" ? principal.groupId : undefined);
  }
  async read(principal: Principal, babyId: string) {
    return this.identity.executeAuthorized(principal, babyId, "records:read", async (_scope, req) => {
      const state = await this.state(babyId, req);
      return { ...membershipStatus(babyId, state.version, state.policy, this.identity.now()), policy: state.policy, changes: await this.repo.changes(babyId, req) };
    });
  }
  /** Call after scope authorization, immediately before a protected effect. Never used for history reads or recovery metadata. */
  async requireAvailable(babyId: string, capability: "chat" | "collection", req?: PayloadRequest): Promise<void> {
    const check = async (request: PayloadRequest) => {
      const state = await this.state(babyId, request);
      const snapshot = membershipStatus(babyId, state.version, state.policy, this.identity.now());
      if (snapshot.entitlements[capability]) return;
      const code = snapshot.status === "paused" ? "SERVICE_PAUSED" : snapshot.status === "scheduled" ? "SERVICE_NOT_STARTED" : "SERVICE_EXPIRED";
      throw new AppError(423, code, snapshot.message, true);
    };
    if (req) return check(req);
    return this.identity.store.transaction(check);
  }
  async execute(principal: Principal, babyId: string, requestId: string, value: unknown, reason?: string) {
    // Only a current Payload operator can configure entitlement; owning a baby never grants operating privileges.
    if (principal.kind !== "operator" || !principal.operatorUserId) throw new AppError(403, "OPS_FORBIDDEN", "请通过有权限的运营后台管理服务。");
    const input = this.schema.parse(value), explanation = opsReason.parse(reason), id = opsRequestId.parse(requestId);
    return this.identity.executeAuthorized(principal, babyId, "baby:manage", async (_scope, req) => {
      const fingerprint = hash({ input, reason: explanation }), key = `membership:${hash([principal.operatorUserId, babyId, id])}`;
      const previous = await this.repo.change(key, babyId, req);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new AppError(409, "MEMBERSHIP_REQUEST_REUSED", "此请求号已用于其他服务配置，请核对后发起新请求。");
        return { ...membershipStatus(babyId, previous.after.version, previous.after.policy, Date.parse(previous.at)), policy: previous.after.policy };
      }
      const before = await this.state(babyId, req);
      if (before.version !== input.expectedVersion) throw new AppError(409, "MEMBERSHIP_VERSION_CONFLICT", "服务配置已有更新，请核对当前版本后重新操作。");
      const policy = { ...before.policy };
      if (input.action === "configure") Object.assign(policy, { startsAt: input.startsAt, endsAt: input.endsAt, expiryPolicy: input.expiryPolicy });
      if (input.action === "extend") {
        if (!policy.endsAt || Date.parse(input.endsAt) <= Date.parse(policy.endsAt)) throw new AppError(400, "MEMBERSHIP_EXTENSION_INVALID", "延期需要已配置截止时间，且新的截止时间须更晚；首次设置请使用免费期配置。");
        policy.endsAt = input.endsAt;
      }
      if (input.action === "pause" || input.action === "resume") policy.paused = input.action === "pause";
      const after = { version: before.version + 1, policy: membershipPolicySchema.parse(policy) };
      const at = new Date(this.identity.now()).toISOString();
      await this.repo.save(babyId, key, { before, after, version: after.version, action: input.action, reason: explanation, at, actorId: principal.operatorUserId!, fingerprint }, req);
      await appendOpsAudit(this.identity.store.payload, { actorId: principal.operatorUserId!, babyId, action: `membership.${input.action}`, reason: explanation,
        target: { requestId: id, previousVersion: before.version, version: after.version }, result: { before: before.policy, after: after.policy } }, req);
      return { ...membershipStatus(babyId, after.version, after.policy, Date.parse(at)), policy: after.policy };
    });
  }
}
