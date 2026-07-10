import type { CollectionBeforeChangeHook, Field } from "payload";
import {
  calendarDateSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema
} from "@cfp/kith-inn-v1-shared/schemas";
import { cmsAuthenticated } from "../access/cmsAuthenticated";
import { assertSameSellerRefs } from "../hooks/assertSameSellerRefs";

export const cmsAccess = {
  read: cmsAuthenticated,
  create: cmsAuthenticated,
  update: cmsAuthenticated,
  delete: cmsAuthenticated
};

export const sameSellerHooks = {
  beforeChange: [assertSameSellerRefs as CollectionBeforeChangeHook]
};

export const trimText = ({ value }: { value?: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export const validateCalendarDate = (value: unknown): true | string =>
  calendarDateSchema.nullish().safeParse(value).success || "必须是有效的 YYYY-MM-DD";

export const validateNonNegativeInteger = (value: unknown): true | string =>
  nonNegativeIntegerSchema.nullish().safeParse(value).success || "必须是非负整数";

export const validatePositiveInteger = (value: unknown): true | string =>
  positiveIntegerSchema.nullish().safeParse(value).success || "必须是正整数";

export const sellerField = (): Field => ({
  name: "seller",
  type: "relationship",
  relationTo: "kiv1_sellers",
  required: true,
  index: true
});
