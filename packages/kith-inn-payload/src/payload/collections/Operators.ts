import type { Access, CollectionBeforeChangeHook, CollectionConfig } from "payload";
import { OPERATOR_ROLES } from "@cfp/kith-inn-shared";
import { tenantScoped } from "../access/tenantScoped";
import { assertSameTenantRefs } from "../hooks/assertSameTenantRefs";
import { stampSeller } from "../hooks/stampSeller";

const canAccessAdmin = ({ req }: { req: { user?: unknown } }) => Boolean(req.user);

const canCreateOperator: Access = ({ req }) => {
  // Existing operators can manage staff; otherwise allow only the explicit
  // bootstrap flag (mirrors website's CMSAdmins pattern) so the first operator
  // can be created during seed / wx-login without an existing session.
  if (req.user) return true;
  return process.env.ALLOW_ADMIN_BOOTSTRAP === "true";
};

/**
 * `operators` — the login principal (PRD §7.1): `wx.login → openid → operator →
 * seller` is the login trust root (Tech Spec §3.1).
 *
 * SPIKE FINDING (b): Payload's `auth: true` assumes email/password and auto-adds
 * those columns. Our real identifier is `wechatOpenid`; the email column is
 * therefore unused and populated with a synthetic value at creation time (PR3 seed
 * / PR4 wx-login). Recorded in apps/cms/SPIKE.md.
 */
export const Operators: CollectionConfig = {
  slug: "operators",
  auth: true,
  admin: {
    useAsTitle: "email",
    group: "平台",
  },
  // read/update/delete are scoped to req.user.seller (an operator manages only
  // their own kitchen's staff, not every seller's — P2). create stays
  // bootstrap-aware (the first operator has no session yet).
  access: {
    admin: canAccessAdmin,
    ...tenantScoped(),
    create: canCreateOperator,
  },
  // Stamp the creator's seller on create (so an authenticated operator can't
  // create staff attributed to another seller) and guard cross-tenant refs —
  // same defense-in-depth as every other tenant-scoped collection.
  hooks: {
    beforeChange: [
      stampSeller as CollectionBeforeChangeHook,
      assertSameTenantRefs as CollectionBeforeChangeHook,
    ],
  },
  fields: [
    {
      name: "wechatOpenid",
      type: "text",
      index: true,
      unique: true,
      admin: { readOnly: true },
    },
    {
      name: "role",
      type: "select",
      options: [...OPERATOR_ROLES],
      defaultValue: "owner",
      required: true,
    },
    { name: "active", type: "checkbox", defaultValue: true },
    {
      name: "seller",
      type: "relationship",
      relationTo: "sellers",
      required: true,
      index: true,
    },
  ],
};
