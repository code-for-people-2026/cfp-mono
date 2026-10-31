import { platformInputAllowed, PLATFORM_ONLY_NOTICE } from "@cfp/a-j-oker-contracts";
import { AppError } from "../domain/contracts";

export function requirePlatformInput(input: unknown) {
  if (!platformInputAllowed(input)) throw new AppError(403, PLATFORM_ONLY_NOTICE);
}
export function rejectExternalConnection(): never {
  throw new AppError(403, PLATFORM_ONLY_NOTICE);
}
