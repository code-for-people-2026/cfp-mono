export const policy = { version: "synthetic-privacy-v1", ready: true, contact: "privacy@example.invalid", documents: [{ title: "合成隐私说明", paragraphs: ["仅用于隔离界面测试，不用于真实用户授权。"] }], retention: { chatDays: 30, backupDays: 7, orphanHours: 24, responseDays: 7 } };
export const personal = { policyVersion: policy.version, accepted: true, adultCaregiver: true, sensitive: true, ai: true, images: true };
export const guardian = { policyVersion: policy.version, guardian: true, sensitive: true, ai: true, images: true, collection: false, groupMembersInformed: false, isOwn: true };
/** Existing feature fixtures have already made explicit synthetic privacy choices. */
export function privacyFixture(path: string): unknown {
  if (path === "/api/app/privacy/policy") return policy;
  if (path === "/api/app/privacy/status") return { policy, consentCurrent: true, guardianCurrent: true, canManage: true, consent: personal, guardian };
  if (path === "/api/app/privacy/requests" || path === "/api/app/privacy/deletions" || path === "/api/app/safety") return { data: [] };
}
