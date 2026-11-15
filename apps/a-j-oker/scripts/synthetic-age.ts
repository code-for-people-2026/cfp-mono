import type { Payload } from "payload";
import type { Owner } from "../src/domain/contracts";
import { ageNotice } from "../src/age/policy";
// Test fixture only. No runtime import, environment bypass, or public endpoint.
export async function seedSyntheticAge(payload: Payload, owner: Owner) {
  owner.wechatKey = `synthetic-test:${owner.id}`;
  await payload.create({ collection: "wechat-identities", overrideAccess: true, data: { owner: owner.id, key: owner.wechatKey } });
  await payload.create({ collection: "age-profiles", overrideAccess: true, data: { owner: owner.id, state: "adult", noticeVersion: ageNotice().version, source: "synthetic_fixture_not_real_verification", assurance: "identity_details_match", verifiedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString() } });
}
