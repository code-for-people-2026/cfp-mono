import type { Payload } from "payload";
import { AppError, type Owner } from "../domain/contracts";
import { readJson } from "../server/http";
import { AgeService } from "./service";
const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
export async function agePost(payload: Payload, owner: Owner, action: string | undefined, request: Request) {
  const service = new AgeService(payload, owner);
  if (action === "challenge") return json(await service.challenge(await readJson(request, 2048)));
  if (action === "submit") return json(await service.submit(await readJson(request, 2048)));
  if (action === "cancel") return json(await service.cancel());
  throw new AppError(404, "年龄核验接口不存在");
}
