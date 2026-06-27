/**
 * kith-inn domain entity types — the FE ↔ BE ↔ cms contract. Plain TS, no
 * Payload dependency. They mirror the Payload collection shapes (hand-written
 * because cms disables Payload type generation); drift is watched by review.
 *
 * `seller` / relationship fields are union of bare id or populated doc, matching
 * Payload's shallow (`number | string`) vs populated (`{ id }`) shapes.
 */
import type {
  OfferingCategory,
  OfferingKind,
  OperatorRole,
  SellerStatus,
} from "./enums";

export type Seller = {
  id: string | number;
  name: string;
  status: SellerStatus;
};

export type Operator = {
  id: string | number;
  wechatOpenid: string;
  role: OperatorRole;
  active: boolean;
  seller: string | number | Seller;
};

export type Offering = {
  id: string | number;
  name: string;
  kind: OfferingKind;
  mainIngredient?: string;
  category?: OfferingCategory;
  active?: boolean;
  seller: string | number | Seller;
};
