import type { CollectionConfig } from "payload";
import { isCMSAdmin } from "../access/isCMSAdmin";
// Same fields/auth schema as the original; no public bootstrap or administrator management.
export const CMSAdmins: CollectionConfig = {
  slug: "cms-admins", admin: { useAsTitle: "email", group: "系统" }, auth: true,
  access: { admin: () => false, read: isCMSAdmin, create: () => false, update: () => false, delete: () => false },
  fields: [{ name: "displayName", label: "显示名", type: "text" }],
};
