import type { Access, CollectionConfig } from "payload";
import { isAdmin } from "../access/isAdmin";

const canAccessAdmin = ({ req }: { req: { user?: unknown } }) => Boolean(req.user);

const canCreateAdmin: Access = async ({ req }) => {
  if (req.user) {
    return true;
  }

  if (process.env.ALLOW_ADMIN_BOOTSTRAP !== "true") {
    return false;
  }

  const result = await req.payload.count({
    collection: "cms-admins",
    overrideAccess: true,
  });

  return result.totalDocs === 0;
};

export const CMSAdmins: CollectionConfig = {
  slug: "cms-admins",
  auth: true,
  admin: {
    useAsTitle: "email",
    group: "系统",
  },
  access: {
    admin: canAccessAdmin,
    create: canCreateAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: "displayName",
      label: "显示名",
      type: "text",
    },
  ],
};
