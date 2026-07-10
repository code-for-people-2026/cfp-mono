import type { CollectionConfig } from "payload";
import { BookingBatches } from "./collections/BookingBatches";
import { CustomerProfiles } from "./collections/CustomerProfiles";
import { MealSlots } from "./collections/MealSlots";
import { Offerings } from "./collections/Offerings";
import { Operators } from "./collections/Operators";
import { Orders } from "./collections/Orders";
import { Sellers } from "./collections/Sellers";

export const collections: CollectionConfig[] = [
  Sellers,
  Operators,
  CustomerProfiles,
  Offerings,
  MealSlots,
  BookingBatches,
  Orders
];
