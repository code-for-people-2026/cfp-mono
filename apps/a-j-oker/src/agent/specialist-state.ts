import { approachSchema } from "@cfp/a-j-oker-contracts";
import { z } from "zod";

const sourceSchema = z.object({
  library: z.string().max(120),
  title: z.string().max(500),
  readStatus: z.enum(["snippet", "document"]),
}).strict();

export const specialistStateSchema = z.object({
  taskId: z.string().min(1).max(128),
  expertId: approachSchema,
  name: z.string().min(1).max(80),
  method: z.string().min(1).max(120),
  configurationRevision: z.string().min(1).max(256),
  theme: z.enum(["sage", "blue", "plum", "amber"]),
  layout: z.enum(["reflection", "step_by_step", "action_plan"]),
  status: z.enum(["active", "completed", "unavailable"]),
  sources: z.array(sourceSchema).max(6),
  currentTask: z.string().min(1).max(1200),
  // Stored only in the private execution snapshot. Public projections must use
  // publicSpecialistState(), which drops this server-only prompt binding.
  prompt: z.string().min(1).max(20000),
  allowedComponents: z.array(z.enum(["form", "card", "table", "code", "page", "image"])).max(6),
  preferredComponents: z.array(z.enum(["form", "card", "table", "code", "page", "image"])).max(6),
}).strict();

export type SpecialistState = z.output<typeof specialistStateSchema>;

export function publicSpecialistState(value: unknown) {
  const { prompt: _prompt, currentTask: _task, allowedComponents: _allowed, preferredComponents: _preferred, ...publicValue } = specialistStateSchema.parse(value);
  return publicValue;
}

export function activeSpecialistFromTurns(
  turns: ReadonlyArray<{ id: number; status: string; specialist?: unknown }>,
  afterId = 0,
) {
  const last = turns
    .filter((turn) => turn.id > afterId && turn.status === "completed" && turn.specialist)
    .sort((a, b) => a.id - b.id)
    .at(-1);
  const parsed = last?.specialist ? specialistStateSchema.safeParse(last.specialist) : undefined;
  return parsed?.success && parsed.data.status === "active"
    ? { turnId: last!.id, state: parsed.data }
    : undefined;
}

export function specialistActionMatches(
  active: ReturnType<typeof activeSpecialistFromTurns>,
  action: { taskId: string },
) {
  return !!active && active.state.taskId === action.taskId;
}
