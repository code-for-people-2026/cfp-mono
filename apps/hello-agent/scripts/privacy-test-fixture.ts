import { Repository } from "../src/cms/repository";
import { PrivacyService } from "../src/privacy/service";
import { privacyPolicy } from "../src/privacy/policy";

// Only used by scripts that create a fresh synthetic database. Exercise the
// same consent path as the application before testing successful MCP calls.
export async function consentForFixture(repo: Repository) {
  const person = new PrivacyService(new Repository(repo.payload, { ...repo.owner, auth: "cookie" }));
  await person.consent({
    version: privacyPolicy().version, core: true, model: true, sensitive: true, external: true,
    externalRecipient: { name: "合成测试客户端", contact: "test@example.invalid", region: "隔离测试", privacyUrl: "https://example.invalid/privacy" },
  });
}
