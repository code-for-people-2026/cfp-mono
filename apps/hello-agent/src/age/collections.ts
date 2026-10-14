import { AppError } from "../domain/contracts";
import { ageNotice } from "./policy";
import type { CollectionBeforeChangeHook, CollectionConfig } from "payload";
const access = { read: () => false, create: () => false, update: () => false, delete: () => false };
export const ageCollections: CollectionConfig[] = [
  { slug: "wechat-identities", lockDocuments: false, admin: { hidden: true }, access, fields: [
    { name: "key", type: "text", required: true, unique: true },
    { name: "noticeVersion", type: "text" },
    { name: "consentedAt", type: "date" },
    { name: "profile", type: "json" },
    { name: "owner", type: "text", required: true, unique: true },
  ] },
  { slug: "age-profiles", lockDocuments: false, admin: { hidden: true }, access, fields: [
    { name: "owner", type: "text", required: true, unique: true },
    { name: "state", type: "text", required: true },
    { name: "declaration", type: "text" },
    { name: "noticeVersion", type: "text" },
    { name: "consentedAt", type: "date" },
    { name: "challenge", type: "text" },
    { name: "challengeExpiresAt", type: "date" },
    { name: "verifiedAt", type: "date" },
    { name: "expiresAt", type: "date" },
    { name: "source", type: "text" },
    { name: "reference", type: "text" },
    { name: "assurance", type: "text" },
    { name: "additionalVerification", type: "text" },
    { name: "lastAttemptAt", type: "date" },
    { name: "day", type: "text" },
    { name: "attempts", type: "number", defaultValue: 0 },
  ] },
  { slug: "age-locks", lockDocuments: false, admin: { hidden: true }, access, fields: [
    { name: "key", type: "text", unique: true, required: true },
    { name: "nonce", type: "text", required: true },
    { name: "expiresAt", type: "date", required: true },
  ] },
];

// Request authentication lives at HTTP/MCP boundaries. This hook prevents a
// response already in flight from writing after age expiry or risk review.
// Internal operations evaluation records have no age profile and no end-user credential.
export const guardAgeWrite: CollectionBeforeChangeHook = async ({ req, data }) => {
  if (typeof data.owner !== "string") return data;
  const profile = (await req.payload.find({ collection: "age-profiles", overrideAccess: true, req, limit: 1, where: { owner: { equals: data.owner } } })).docs[0];
  if (profile && (profile.state !== "adult" || profile.assurance !== "identity_details_match" || profile.additionalVerification === "required" || profile.noticeVersion !== ageNotice().version || !profile.expiresAt || Date.parse(String(profile.expiresAt)) <= Date.now())) throw new AppError(403, "年龄核验已失效或需复核，本次内容不再保存");
  return data;
};
