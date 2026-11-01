import type { PrivacyConfig } from "../../src/privacy/policy";
import type { BubuRuntime } from "../../src/runtime";
export const testPrivacyConfig: PrivacyConfig = { company: "Synthetic operator", contact: "privacy@example.test", storageLocation: "合成境内存储", legacyStorageLocation: "合成境内存储", chatDays: 30, backupDays: 7, orphanHours: 24, responseDays: 7, modelName: "Synthetic provider", modelRegion: "合成境内地域", modelPolicy: "https://example.test/privacy", imageReview: { mode: "aliyun-green", policy: "https://example.test/review-privacy", handling: "仅合成测试；未连接真实供应商" } };
export async function grantFixturePrivacy(runtime: BubuRuntime) {
  for (const [user, babyId] of [["old-alice", "baby-a"], ["old-bob", "baby-b"]]) {
    const principal = await runtime.identity.authenticate((await runtime.identity.loginLegacy(user!, "correct-password", "native")).token);
    const policyVersion = runtime.privacy.policy().version;
    await runtime.privacy.consent(principal, { policyVersion, accepted: true, adultCaregiver: true, sensitive: true, ai: true, images: true });
    await runtime.privacy.guardian(principal, babyId!, { policyVersion, guardian: true, sensitive: true, ai: true, images: true, collection: true, groupMembersInformed: true });
  }
}

export const fixtureImageReviewer = async () => "allow" as const;
