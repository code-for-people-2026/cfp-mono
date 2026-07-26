import { sql } from "@payloadcms/db-postgres";
import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type PayloadRequest
} from "payload";

const COLLECTION = "kiv1_meal_slots";
export const KIV1_AVAILABILITY_CHECKED = "kiv1AvailabilityChecked";

type MealSlot = {
  id: number | string;
  generatedAt?: unknown;
  menuItems?: unknown;
  orderStatus?: unknown;
};

function unavailable(): never {
  throw new APIError("meal-slot-menu-guard-unavailable", 500);
}

function relationshipId(value: unknown): unknown {
  return typeof value === "object" && value !== null && "id" in value
    ? (value as { id: unknown }).id
    : value;
}

function normalizedMenu(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((row) => {
    if (typeof row !== "object" || row === null) return row;
    const item = row as Record<string, unknown>;
    return {
      offering: relationshipId(item.offering),
      nameSnapshot: item.nameSnapshot ?? null,
      mainIngredientSnapshot: item.mainIngredientSnapshot ?? null,
      categorySnapshot: item.categorySnapshot ?? null
    };
  });
}

function normalizedDate(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return value;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function menuChanged(data: Record<string, unknown>, latest: MealSlot): boolean {
  if (Object.hasOwn(data, "menuItems") &&
      JSON.stringify(normalizedMenu(data.menuItems)) !== JSON.stringify(normalizedMenu(latest.menuItems))) {
    return true;
  }
  return Object.hasOwn(data, "generatedAt") &&
    normalizedDate(data.generatedAt) !== normalizedDate(latest.generatedAt);
}

function statusRegresses(current: unknown, requested: unknown): boolean {
  return current !== "draft" && requested === "draft";
}

function opensWithoutAvailabilityCheck(req: PayloadRequest, current: unknown, requested: unknown): boolean {
  return current !== "open" && requested === "open" && req.context[KIV1_AVAILABILITY_CHECKED] !== true;
}

async function transactionSession(req: PayloadRequest): Promise<unknown> {
  const transactionId = await req.transactionID;
  if (transactionId == null) unavailable();
  return req.payload.db.sessions?.[String(transactionId)]?.db ?? unavailable();
}

async function lockedLatest(req: PayloadRequest, id: number | string): Promise<MealSlot> {
  const transaction = await transactionSession(req);
  if (req.payload.db.name === "postgres") {
    const database = req.payload.db as typeof req.payload.db & {
      execute(args: { db: unknown; sql: ReturnType<typeof sql> }): Promise<unknown>;
    };
    if (typeof database.execute !== "function") unavailable();
    await database.execute({
      db: transaction,
      sql: sql`SELECT "id" FROM "cms"."kiv1_meal_slots" WHERE "id" = ${id} FOR UPDATE`
    });
  } else if (req.payload.db.name !== "sqlite") {
    unavailable();
  }

  const latest = await req.payload.db.findOne<MealSlot>({
    collection: COLLECTION,
    req,
    where: { id: { equals: id } }
  });
  return latest ?? unavailable();
}

/**
 * Persistence boundary shared by local API, Admin and REST writes. Payload starts
 * the transaction before collection hooks. originalDoc supplies only the row
 * identifier (including bulk updates); protected state is read after locking.
 */
export const guardKiv1MealSlotMenuChange: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req
}) => {
  if (operation !== "update" ||
      (!Object.hasOwn(data, "menuItems") &&
       !Object.hasOwn(data, "generatedAt") &&
       !Object.hasOwn(data, "orderStatus"))) {
    return data;
  }
  const id = originalDoc?.id;
  if (typeof id !== "number" && typeof id !== "string") unavailable();
  const latest = await lockedLatest(req, id);
  if (menuChanged(data, latest) && latest.orderStatus !== "draft") {
    throw new APIError("meal-slot-menu-locked", 409);
  }
  if (Object.hasOwn(data, "orderStatus") && statusRegresses(latest.orderStatus, data.orderStatus)) {
    throw new APIError("meal-slot-order-status-locked", 409);
  }
  if (Object.hasOwn(data, "orderStatus") &&
      opensWithoutAvailabilityCheck(req, latest.orderStatus, data.orderStatus)) {
    throw new APIError("meal-slot-open-requires-availability-check", 409);
  }
  return data;
};

export function withKiv1MealSlotMenuGuard(collection: CollectionConfig): CollectionConfig {
  if (collection.slug !== COLLECTION) return collection;
  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      beforeChange: [...(collection.hooks?.beforeChange ?? []), guardKiv1MealSlotMenuChange]
    }
  };
}
