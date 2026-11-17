import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AJ_A2A_FAULT_CONTROL_ENV,
  AJ_A2A_FAULT_OWNER,
  DISABLED_A2A_FAULTS,
  isConfirmedCompletedA2AResponse,
  loadA2AFaultPolicy,
} from "./devtools-faults";

const base = `/tmp/aj-recovery-qa/vitest-${crypto.randomUUID()}`;
const external = `/tmp/a2a-fault-escape-${crypto.randomUUID()}.json`;
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  await rm(external, { force: true });
});

async function controlFile(modes: Record<string, boolean>) {
  await mkdir(base, { recursive: true });
  await chmod(base, 0o700);
  const file = path.join(base, "control.json");
  await writeFile(file, JSON.stringify({
    schemaVersion: 1,
    owner: AJ_A2A_FAULT_OWNER,
    modes,
  }), { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

describe("A2A local fault fixture", () => {
  it("requires the exact synthetic owner and private local file", async () => {
    const file = await controlFile({ failFirstSendBeforeExecution: true });
    await expect(loadA2AFaultPolicy({
      owner: AJ_A2A_FAULT_OWNER,
      env: { [AJ_A2A_FAULT_CONTROL_ENV]: file },
    })).resolves.toMatchObject({ enabled: true, failFirstSendBeforeExecution: true });

    await expect(loadA2AFaultPolicy({
      owner: "real-user",
      env: { [AJ_A2A_FAULT_CONTROL_ENV]: file },
    })).resolves.toEqual(DISABLED_A2A_FAULTS);
  });

  it("is disabled by default when the local control file is absent", async () => {
    await expect(loadA2AFaultPolicy({
      owner: AJ_A2A_FAULT_OWNER,
      env: {},
      controlFile: `/tmp/aj-recovery-qa/absent-${crypto.randomUUID()}.json`,
    })).resolves.toEqual(DISABLED_A2A_FAULTS);
  });

  it("is disabled when every mode in the control file is false", async () => {
    const file = await controlFile({
      rejectFirstTwoExpertSubmissions: false,
      failFirstSendBeforeExecution: false,
      failFirstModelAttempt: false,
      loseFirstResponseAfterCommit: false,
    });
    await expect(loadA2AFaultPolicy({
      owner: AJ_A2A_FAULT_OWNER,
      env: { [AJ_A2A_FAULT_CONTROL_ENV]: file },
    })).resolves.toEqual(DISABLED_A2A_FAULTS);
  });

  it("is disabled in production/deployed environments even with a control file", async () => {
    const file = await controlFile({ loseFirstResponseAfterCommit: true });
    await expect(loadA2AFaultPolicy({
      owner: AJ_A2A_FAULT_OWNER,
      env: {
        [AJ_A2A_FAULT_CONTROL_ENV]: file,
        NODE_ENV: "production",
      },
    })).resolves.toEqual(DISABLED_A2A_FAULTS);
    await expect(loadA2AFaultPolicy({
      owner: AJ_A2A_FAULT_OWNER,
      env: { [AJ_A2A_FAULT_CONTROL_ENV]: file, HELLO_DEPLOYED: "true" },
    })).resolves.toEqual(DISABLED_A2A_FAULTS);
  });

  it("rejects public control files rather than partially enabling", async () => {
    const file = await controlFile({ rejectFirstTwoExpertSubmissions: true });
    await chmod(file, 0o640);
    await expect(loadA2AFaultPolicy({
      owner: AJ_A2A_FAULT_OWNER,
      env: { [AJ_A2A_FAULT_CONTROL_ENV]: file },
    })).rejects.toThrow("owner-only");
  });

  it("rejects a control-file symlink instead of following it outside the QA scope", async () => {
    await controlFile({ failFirstModelAttempt: true });
    await writeFile(external, JSON.stringify({
      schemaVersion: 1,
      owner: AJ_A2A_FAULT_OWNER,
      modes: { failFirstModelAttempt: true },
    }), { mode: 0o600 });
    await chmod(external, 0o600);
    const link = path.join(base, "control-link.json");
    await symlink(external, link);

    await expect(loadA2AFaultPolicy({
      owner: AJ_A2A_FAULT_OWNER,
      env: { [AJ_A2A_FAULT_CONTROL_ENV]: link },
    })).rejects.toThrow("owner-only");
  });

  it("confirms response loss only for a durable completed JSON-RPC task", async () => {
    const task = (state: string) => Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: { task: { id: "task-1", contextId: "context-1", status: { state } } },
    }, { headers: { "content-type": "application/json" } });

    await expect(isConfirmedCompletedA2AResponse(task("TASK_STATE_COMPLETED")))
      .resolves.toBe(true);
    await expect(isConfirmedCompletedA2AResponse(task("TASK_STATE_WORKING")))
      .resolves.toBe(false);
    await expect(isConfirmedCompletedA2AResponse(Response.json({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32_000, message: "error" },
    }))).resolves.toBe(false);
    await expect(isConfirmedCompletedA2AResponse(new Response("unavailable", { status: 503 })))
      .resolves.toBe(false);
  });
});
