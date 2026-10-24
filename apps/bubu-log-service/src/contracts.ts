export type Permission = "records:read" | "records:write" | "media:read" | "media:write" | "baby:manage" | "caregivers:manage";
export const permissions: Permission[] = ["records:read", "records:write", "media:read", "media:write", "baby:manage", "caregivers:manage"];
export type ActorKind = "caregiver" | "collector" | "chat-agent" | "operator";
export interface Baby { id: string; name: string; fullName?: string | null; avatarUrl?: string | null; birthDate?: string | null; gender?: string | null; isDefault?: boolean }
export interface LegacyUser { id: string }
/** The legacy system remains authoritative for existing users and BabyUser relations. */
export interface LegacyBackend {
  verifyCredentials(username: string, password: string): Promise<LegacyUser>;
  createFamily(identityId: string, input: { name: string }): Promise<{ userId: string; baby: Baby }>;
  /** Read-only recovery of a provisioned account, with deterministic ownership verification. */
  findFamilyAccount(identityId: string): Promise<LegacyUser | null>;
  userExists(userId: string): Promise<boolean>;
  listBabies(userId: string): Promise<Baby[]>;
  getBaby(babyId: string): Promise<Baby | null>;
  read(babyId: string, path: string, query: URLSearchParams): Promise<unknown>;
  updateBabyNames(babyId: string, input: { name: string; fullName: string | null }): Promise<Baby>;
}
export interface WechatProvider { exchange(code: string): Promise<{ appId: string; openId: string }> }
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public readonly retryable?: boolean) { super(message); }
}
