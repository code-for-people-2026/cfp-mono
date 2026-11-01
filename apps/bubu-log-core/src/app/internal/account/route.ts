import { coreAccess, mutationAccess } from '../../../security';
import { getCore } from '../../../client';
import { LifecycleError } from '../../../lifecycle';
import { accountLifecycle } from '../../../account-lifecycle';
export const dynamic = 'force-dynamic';
async function handle(req: Request, operation: "read" | "write") {
  const denied = coreAccess(req); if (denied) return denied;
  if (operation === "write") { const held = mutationAccess(); if (held) return held; }
  try {
    const payload = await getCore(), {user} = await payload.auth({headers:req.headers});
    if (user?.collection !== 'cms-admins' || !process.env.BUBU_CORE_CMS_EMAIL || user.email !== process.env.BUBU_CORE_CMS_EMAIL) return Response.json({error:'CORE_UNAUTHORIZED'},{status:401});
    const userId = new URL(req.url).searchParams.get('userId') || '', lifecycle = accountLifecycle();
    if (operation === "read") return Response.json({userId,data:await lifecycle.exportAccountData(userId)},{headers:{'Cache-Control':'no-store'}});
    await lifecycle.deleteAccountData(userId);
    return Response.json({userId,deleted:true},{headers:{'Cache-Control':'no-store'}});
  } catch (error) { return Response.json({error:error instanceof LifecycleError ? error.code : 'CORE_ACCOUNT_UNAVAILABLE'},{status:error instanceof LifecycleError ? error.status : 503}); }
}
export const GET = (req: Request) => handle(req, "read");
export const DELETE = (req: Request) => handle(req, "write");
