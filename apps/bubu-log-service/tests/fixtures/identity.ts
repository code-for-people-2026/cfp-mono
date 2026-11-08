import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AppError, type Baby, type LegacyBackend, type WechatProvider } from "../../src/contracts";
import { IdentityService } from "../../src/identity";
import { openStore, type Store } from "../../src/store";

/**
 * Only the external providers are injected. Identity state uses Payload + SQLite.
 * @public Synthetic legacy boundary shared by downstream module integration tests.
 */
export class LegacyFixture implements LegacyBackend {
  users = new Set(["old-alice", "old-bob"]);
  babies = new Map<string, Baby>([
    ["baby-a", { id: "baby-a", name: "小一", isDefault: true }],
    ["baby-b", { id: "baby-b", name: "小二", isDefault: true }],
  ]);
  memberships = new Map<string, string[]>([["old-alice", ["baby-a"]], ["old-bob", ["baby-b"]]]);
  credentials: Array<{ username: string; password: string }> = [];
  families = new Map<string, { userId: string; baby: Baby }>();
  familyCalls: Array<{ identityId: string; name: string }> = [];
  reads: Array<{ babyId: string; path: string }> = [];
  failFamilyOnce = false;

  async verifyCredentials(username: string, password: string) {
    this.credentials.push({ username, password });
    if (!this.users.has(username) || password !== "correct-password") throw new AppError(401, "LEGACY_CREDENTIALS_INVALID", "旧账号或密码不正确。");
    return { id: username };
  }
  async createFamily(identityId: string, input: { name: string }) {
    this.familyCalls.push({ identityId, name: input.name });
    let family = this.families.get(identityId);
    if (!family) {
      const userId = `family-user-${identityId}`;
      const baby = { id: `family-baby-${identityId}`, name: input.name, isDefault: true };
      family = { userId, baby };
      this.families.set(identityId, family);
      this.users.add(userId);
      this.babies.set(baby.id, baby);
      this.memberships.set(userId, [baby.id]);
    }
    if (this.failFamilyOnce) {
      this.failFamilyOnce = false;
      throw new AppError(502, "LEGACY_UNAVAILABLE", "模拟上游已提交但响应丢失。");
    }
    return family;
  }
  async userExists(userId: string) { return this.users.has(userId); }
  async listBabies(userId: string) { return (this.memberships.get(userId) || []).flatMap(id => this.babies.has(id) ? [this.babies.get(id)!] : []); }
  async getBaby(babyId: string) { return this.babies.get(babyId) || null; }
  async read(babyId: string, resource: string, _query: URLSearchParams) {
    this.reads.push({ babyId, path: resource });
    return [{ id: "record-a", babyId, type: "SLEEP" }];
  }
  async updateBabyNames(babyId: string, input: { name: string; fullName: string | null }) {
    const baby = { ...this.babies.get(babyId)!, ...input };
    this.babies.set(babyId, baby);
    return baby;
  }
}

/** @public Synthetic WeChat boundary shared by downstream module integration tests. */
export class WechatFixture implements WechatProvider {
  exchanges: string[] = [];
  async exchange(code: string) {
    this.exchanges.push(code);
    if (code === "invalid-code") throw new AppError(401, "WECHAT_CODE_INVALID", "微信凭证失效。");
    // Distinct one-time codes can identify the same verified account.
    const [appId, openId] = code.split(":");
    if (!appId || !openId) throw new Error("Fixture code must be app:openid:nonce");
    return { appId, openId };
  }
}

export async function identityFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "bubu-identity-test-"));
  const legacy = new LegacyFixture();
  const wechat = new WechatFixture();
  let clock = Date.parse("2026-10-23T00:00:00.000Z");
  let store: Store = await openStore({ directory });
  let service = new IdentityService(store, legacy, wechat, () => clock, 60_000);
  return {
    directory, legacy, wechat,
    get store() { return store; },
    get service() { return service; },
    advance(ms: number) { clock += ms; },
    async restart() {
      await store.close();
      store = await openStore({ directory });
      service = new IdentityService(store, legacy, wechat, () => clock, 60_000);
    },
    async close() { await store.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

export type IdentityFixture = Awaited<ReturnType<typeof identityFixture>>;
