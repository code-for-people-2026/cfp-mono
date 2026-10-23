import config from "@payload-config";
import { assertRuntimeAvailable } from "../../../../../runtime-state";
import { REST_GET, REST_POST, REST_PATCH, REST_DELETE, REST_OPTIONS } from "@payloadcms/next/routes";
export const dynamic = "force-dynamic";
const guarded = (handler: ReturnType<typeof REST_GET>) => async (...args: Parameters<typeof handler>) => {
  assertRuntimeAvailable();
  return handler(...args);
};
export const GET = guarded(REST_GET(config));
export const POST = guarded(REST_POST(config));
export const PATCH = guarded(REST_PATCH(config));
export const DELETE = guarded(REST_DELETE(config));
export const OPTIONS = guarded(REST_OPTIONS(config));
