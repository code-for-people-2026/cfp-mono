import { ZodError } from "zod";
import type { Payload } from "payload";
import { cms } from "../../../cms/client";
import {
  FirstAdminUnavailableError,
  isFirstAdminRegistrationOpen,
  registerFirstAdmin,
} from "../../../cms/first-admin";

const closed = () => Response.json({ error: "Not found" }, { status: 404 });

export async function firstAdminStatus(payload: Payload) {
  if (!await isFirstAdminRegistrationOpen(payload)) return closed();
  return Response.json({ open: true });
}

export async function createFirstAdmin(request: Request, payload: Payload) {
  if (!await isFirstAdminRegistrationOpen(payload)) return closed();
  try {
    const body = await request.json();
    const admin = await registerFirstAdmin(payload, body);
    return Response.json({ id: admin.id }, { status: 201 });
  } catch (error) {
    if (error instanceof FirstAdminUnavailableError) return closed();
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message || "输入无效" },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "请求格式无效" }, { status: 400 });
    }
    throw error;
  }
}

export async function GET() {
  return firstAdminStatus(await cms());
}

export async function POST(request: Request) {
  return createFirstAdmin(request, await cms());
}
