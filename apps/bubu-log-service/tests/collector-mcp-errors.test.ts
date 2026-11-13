import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/contracts";
import { CollectorMcpClient, McpToolError } from "../src/collector/runner";

async function callFailure(result: unknown): Promise<McpToolError> {
  const client = new CollectorMcpClient(new URL("http://127.0.0.1/api/mcp"), async () => "test-token");
  vi.spyOn(client.client as unknown as { callTool: (request: unknown) => Promise<unknown> }, "callTool").mockResolvedValue(result);
  let error: unknown;
  try { await client.call("bubu_collector", { action: "status" }); }
  catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(McpToolError);
  return error as McpToolError;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("collector MCP error sanitization", () => {
  it("preserves a valid conflict when routing fields are omitted", async () => {
    const error = await callFailure({ isError: true, structuredContent: { code: "VERSION_CONFLICT" } });
    expect(error).toMatchObject({ status: 409, code: "VERSION_CONFLICT", message: "VERSION_CONFLICT", retryable: false, mcpCode: "VERSION_CONFLICT" });
  });

  it("uses the retryable default when status is omitted without exposing server text", async () => {
    const error = await callFailure({ isError: true, structuredContent: { code: "VERSION_CONFLICT", retryable: true, error: "private server text" } });
    expect(error).toMatchObject({ status: 503, code: "VERSION_CONFLICT", retryable: true, mcpCode: "VERSION_CONFLICT" });
    expect(error.message).not.toContain("private server text");
  });

  it("preserves a valid status when retryable is omitted without exposing server text", async () => {
    const error = await callFailure({ isError: true, structuredContent: { code: "VERSION_CONFLICT", status: 502, error: "private server text" } });
    expect(error).toMatchObject({ status: 502, code: "VERSION_CONFLICT", retryable: false, mcpCode: "VERSION_CONFLICT" });
    expect(error.message).not.toContain("private server text");
  });

  it("sanitizes non-object failure payloads", async () => {
    for (const structuredContent of [null, "private server text"]) {
      const error = await callFailure({ isError: true, structuredContent });
      expect(error).toMatchObject({ status: 409, code: "MCP_TOOL_FAILED", message: "MCP_TOOL_FAILED", retryable: false, mcpCode: "MCP_TOOL_FAILED" });
      expect(error.message).not.toContain("private server text");
    }
  });

  it("sanitizes malformed JSON failure payloads", async () => {
    const error = await callFailure({ isError: true, content: [{ type: "text", text: '{"code":"VERSION_CONFLICT","error":"private server text"' }] });
    expect(error).toMatchObject({ status: 409, code: "MCP_TOOL_FAILED", message: "MCP_TOOL_FAILED", retryable: false, mcpCode: "MCP_TOOL_FAILED" });
    expect(error.message).not.toContain("private server text");
  });

  it("routes valid status and retryable fields as an AppError", async () => {
    const error = await callFailure({ isError: true, structuredContent: { code: "UPSTREAM_UNAVAILABLE", status: 502, retryable: true, error: "private server text" } });
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 502, code: "UPSTREAM_UNAVAILABLE", message: "MCP_TOOL_FAILED", retryable: true, mcpCode: "UPSTREAM_UNAVAILABLE" });
    expect(error.message).not.toContain("private server text");
  });
});
