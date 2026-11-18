import { describe, expect, it } from "vitest";
import {
  activeSpecialistFromTurns,
  publicSpecialistState,
  specialistActionMatches,
  type SpecialistState,
} from "./specialist-state";
import { publicAJokerState } from "../domain/public-a-j-oker";

const active: SpecialistState = {
  taskId: "task-1",
  expertId: "cbt",
  name: "认知行为心理专家（AI）",
  method: "认知行为",
  configurationRevision: "7:revision",
  theme: "blue",
  layout: "step_by_step",
  status: "active",
  sources: [{ library: "方法库", title: "可读正文", readStatus: "document" }],
  currentTask: "处理本次自责",
  prompt: "server-only-prompt",
  allowedComponents: ["form"],
  preferredComponents: ["form"],
};

describe("durable specialist state", () => {
  it("reload derives the latest committed transition and failed turns do not erase it", () => {
    const derived = activeSpecialistFromTurns([
      { id: 1, status: "completed", specialist: active },
      { id: 2, status: "failed" },
    ]);
    expect(derived).toEqual({ turnId: 1, state: active });
    expect(specialistActionMatches(derived, { taskId: "task-1" })).toBe(true);
    expect(specialistActionMatches(derived, { taskId: "foreign-task" })).toBe(false);
  });

  it("completed transition ends routing and public projection never exposes private binding", () => {
    expect(activeSpecialistFromTurns([
      { id: 1, status: "completed", specialist: active },
      { id: 3, status: "completed", specialist: { ...active, status: "completed" } },
    ])).toBeUndefined();
    expect(publicSpecialistState(active)).toEqual(expect.objectContaining({
      name: active.name,
      theme: "blue",
      sources: active.sources,
    }));
    expect(JSON.stringify(publicSpecialistState(active))).not.toContain("server-only-prompt");
    expect(publicSpecialistState(active)).not.toHaveProperty("currentTask");
  });

  it("uses an explicit forget boundary without treating ordinary compaction as forgetting", () => {
    expect(activeSpecialistFromTurns([
      { id: 4, status: "completed", specialist: active },
    ], 4)).toBeUndefined();
    expect(activeSpecialistFromTurns([
      { id: 4, status: "completed", specialist: active },
      { id: 6, status: "completed", specialist: { ...active, taskId: "task-2" } },
    ], 4)?.state.taskId).toBe("task-2");
  });

  it("drops malformed private specialist snapshots at the public boundary", () => {
    const projected = publicAJokerState({
      id: 1,
      owner: "private-owner",
      requestKey: "private-request-key",
      fingerprint: "private-fingerprint",
      specialist: { prompt: "secret", currentTask: "secret task" },
    });
    expect(projected).not.toHaveProperty("specialist");
    expect(projected).not.toHaveProperty("owner");
    expect(projected).not.toHaveProperty("requestKey");
    expect(projected).not.toHaveProperty("fingerprint");
    expect(JSON.stringify(projected)).not.toContain("secret");
  });
});
