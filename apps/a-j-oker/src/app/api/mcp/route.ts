import { failure } from "../../../server/http";
import { rejectExternalConnection } from "../../../server/service-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 首版不对外提供 MCP；旧令牌也不能建立连接，不读取或写入业务数据。
export function POST(request: Request) {
  void request; // 保留路由签名，但不读取正文或访问任何业务资源。
  try { rejectExternalConnection(); } catch (error) { return failure(error); }
}
export const GET = POST;
export const DELETE = POST;
