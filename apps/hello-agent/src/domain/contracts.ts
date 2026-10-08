export {
  inputSchema,
  turnSchema,
  greetingSchema,
  externalSchema,
  type Inspiration,
  type Greeting,
  type Mode,
} from "@cfp/hello-agent-contracts";
export type Owner = { id: string; auth: "cookie" | "bearer" | "miniapp" };

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
