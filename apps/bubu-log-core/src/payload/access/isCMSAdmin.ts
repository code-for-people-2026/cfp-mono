import type { Access } from "payload";
// Only the dedicated service credential may enter this private copy of the legacy API.
export const isCMSAdmin: Access = ({ req }) => req.user?.collection === "cms-admins" && !!process.env.BUBU_CORE_CMS_EMAIL && req.user.email === process.env.BUBU_CORE_CMS_EMAIL;
