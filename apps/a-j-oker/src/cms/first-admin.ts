import {
  APIError,
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type CollectionBeforeChangeHook,
  type Payload,
} from "payload";
import { z } from "zod";

const FIRST_ADMIN_LATCH = "first-administrator-created";

const registrationSchema = z
  .object({
    email: z.string().trim().email("请输入有效的邮箱地址"),
    password: z.string().min(12, "密码至少需要 12 位"),
    confirmPassword: z.string(),
  })
  .refine(({ password, confirmPassword }) => password === confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

export class FirstAdminUnavailableError extends Error {
  constructor() {
    super("管理员初始化已关闭");
    this.name = "FirstAdminUnavailableError";
  }
}

const queues = new WeakMap<Payload, Promise<void>>();

async function serializedTransaction<T>(
  payload: Payload,
  action: Parameters<typeof withTransaction<T>>[1],
) {
  const previous = queues.get(payload) || Promise.resolve();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  queues.set(payload, waiting);
  await previous;
  try {
    return await withTransaction(payload, action);
  } finally {
    release();
    if (queues.get(payload) === waiting) queues.delete(payload);
  }
}

async function withTransaction<T>(
  payload: Payload,
  action: (req: Awaited<ReturnType<typeof createLocalReq>>) => Promise<T>,
) {
  const req = await createLocalReq({
    context: { helloFirstAdminRegistration: true },
  }, payload);
  if (!await initTransaction(req)) {
    throw new Error("管理员初始化需要数据库事务");
  }
  try {
    const result = await action(req);
    await commitTransaction(req);
    return result;
  } catch (error) {
    await killTransaction(req);
    throw error;
  }
}

function isUniqueConflict(error: unknown) {
  if (!(error instanceof Error)) return false;
  const cause = "cause" in error ? error.cause : undefined;
  const code = "code" in error ? error.code : undefined;
  const causeCode = cause && typeof cause === "object" && "code" in cause
    ? cause.code
    : undefined;
  return code === "SQLITE_CONSTRAINT" || causeCode === "SQLITE_CONSTRAINT" ||
    /unique|constraint/i.test(error.message);
}

export async function isFirstAdminRegistrationOpen(payload: Payload) {
  const latch = await payload.count({
    collection: "admin-initializations",
    overrideAccess: true,
    where: { key: { equals: FIRST_ADMIN_LATCH } },
  });
  if (latch.totalDocs > 0) return false;
  const admins = await payload.count({ collection: "admins", overrideAccess: true });
  return admins.totalDocs === 0;
}

export async function registerFirstAdmin(payload: Payload, input: unknown) {
  const data = registrationSchema.parse(input);
  try {
    return await serializedTransaction(payload, async (req) => {
      const admins = await payload.count({
        collection: "admins",
        overrideAccess: true,
        req,
      });
      if (admins.totalDocs !== 0) throw new FirstAdminUnavailableError();

      await payload.create({
        collection: "admin-initializations",
        overrideAccess: true,
        req,
        data: { key: FIRST_ADMIN_LATCH },
      });
      return payload.create({
        collection: "admins",
        overrideAccess: true,
        req,
        data: {
          email: data.email,
          password: data.password,
          role: "administrator",
        },
      });
    });
  } catch (error) {
    if (error instanceof FirstAdminUnavailableError) throw error;
    if (isUniqueConflict(error)) throw new FirstAdminUnavailableError();
    throw error;
  }
}

export const guardAdminCreation: CollectionBeforeChangeHook = async ({
  req,
  operation,
  data,
}) => {
  if (req.user?.collection === "admins") return data;
  if (
    operation !== "create" ||
    (req.context.helloFirstAdminRegistration !== true &&
      req.context.helloAdminBootstrap !== true)
  ) {
    throw new APIError("管理员注册未开放", 403);
  }
  if (req.transactionID == null) {
    throw new APIError("管理员初始化需要数据库事务", 500);
  }

  const latch = await req.payload.count({
    collection: "admin-initializations",
    overrideAccess: true,
    req,
    where: { key: { equals: FIRST_ADMIN_LATCH } },
  });
  const admins = await req.payload.count({
    collection: "admins",
    overrideAccess: true,
    req,
  });
  // Preserve trusted Local API fixtures while routing them through the same
  // durable, transactional arbiter as the UI and CLI. The legacy bootstrap is
  // allowed to create the latch, but can never consume an existing latch.
  if (req.context.helloAdminBootstrap === true) {
    if (latch.totalDocs !== 0 || admins.totalDocs !== 0) {
      throw new APIError("管理员初始化已关闭", 403);
    }
    await req.payload.create({
      collection: "admin-initializations",
      overrideAccess: true,
      req,
      data: { key: FIRST_ADMIN_LATCH },
    });
  } else if (latch.totalDocs !== 1 || admins.totalDocs !== 0) {
    throw new APIError("管理员初始化已关闭", 403);
  }
  data.role = "administrator";
  return data;
};
