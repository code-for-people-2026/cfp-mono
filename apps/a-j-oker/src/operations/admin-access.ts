import { APIError, type CollectionBeforeChangeHook, type CollectionBeforeDeleteHook } from "payload";
import { isAdministrator } from "./policy";
import { audit } from "./audit";
async function anotherAdministrator(req: Parameters<CollectionBeforeDeleteHook>[0]["req"], id: string | number) {
  return (await req.payload.count({ collection: "admins", overrideAccess: true, req, where: { and: [{ id: { not_equals: id } }, { role: { equals: "administrator" } }] } })).totalDocs > 0;
}
export const protectLastAdministrator: CollectionBeforeChangeHook = async ({ req, data, originalDoc, operation }) => {
  if (operation === "update" && (!originalDoc.role || originalDoc.role === "administrator") && data.role && data.role !== "administrator" && !await anotherAdministrator(req, originalDoc.id))
    throw new APIError("不能取消最后一个系统管理员的权限", 409);
  return data;
};
export const auditAdminDeletion: CollectionBeforeDeleteHook = async ({ req, id }) => {
  if (!isAdministrator(req.user)) throw new APIError("账户删除需要系统管理员权限", 403);
  const user = await req.payload.findByID({ collection: "admins", id, overrideAccess: true, req });
  if (isAdministrator({ ...user, collection: "admins" }) && !await anotherAdministrator(req, id)) throw new APIError("不能删除最后一个系统管理员", 409);
  await audit(req.payload, `admin:${req.user!.id}`, "permission.delete", `admin:${id}`, "管理员账户删除", { role: user.role }, req);
};
