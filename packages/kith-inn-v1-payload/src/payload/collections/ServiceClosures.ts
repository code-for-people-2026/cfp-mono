import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type PayloadRequest
} from "payload";
import { OCCASIONS } from "@cfp/kith-inn-v1-shared";
import {
  cmsAccess,
  sameSellerHooks,
  sellerField,
  trimText,
  validateCalendarDate
} from "./shared";

export const KIV1_SERVICE_CLOSURE_CHECKED = "kiv1ServiceClosureChecked";

function requireControlledWrite(req: PayloadRequest): void {
  if (req.context[KIV1_SERVICE_CLOSURE_CHECKED] !== true) {
    throw new APIError("service-closure-requires-availability-check", 409);
  }
}

export const requireCheckedServiceClosureChange: CollectionBeforeChangeHook = ({ data, req }) => {
  requireControlledWrite(req);
  return data;
};

export const ServiceClosures: CollectionConfig = {
  slug: "kiv1_service_closures",
  admin: { useAsTitle: "date", group: "街坊味 v1 / 预订" },
  // 打烊写入必须经过带 seller/date 锁和业务冲突检查的 internal route。
  // Payload Admin/REST 只保留读取能力，避免绕过受控写路径。
  access: {
    ...cmsAccess,
    create: () => false,
    update: () => false,
    delete: () => false
  },
  hooks: {
    ...sameSellerHooks,
    beforeChange: [requireCheckedServiceClosureChange, ...sameSellerHooks.beforeChange]
  },
  fields: [
    sellerField(),
    { name: "date", type: "text", required: true, validate: validateCalendarDate },
    { name: "occasion", type: "select", required: false, options: [...OCCASIONS] },
    {
      name: "note",
      type: "text",
      maxLength: 80,
      hooks: { beforeValidate: [trimText] }
    }
  ],
  // NULL-aware uniqueness is supplied by the CMS partial indexes.
  indexes: [{ fields: ["seller", "date", "occasion"] }]
};
