import { beforeEach, expect, it, vi } from "vitest";
import { AppError, type Owner } from "../domain/contracts";
import { GET, POST } from "../app/api/hello/[...path]/route";

const service = vi.hoisted(() => ({ exportData: vi.fn(), withdraw: vi.fn(), recoverOwner: vi.fn() }));
vi.mock("../cms/client", () => ({ cms: vi.fn(async () => ({})) }));
vi.mock("./service", () => ({ privacyService: () => service, withRecoveredOwner: service.recoverOwner }));
vi.mock("../domain/greetings", () => ({ GreetingService: class {} }));
vi.mock("../domain/context", () => ({ ContextService: class {} }));
vi.mock("../server/ag-ui", () => ({ agentStream: vi.fn(), readAgentInput: vi.fn() }));
vi.mock("../server/auth", () => ({ withAuthenticatedExecution: async (_payload: unknown, _request: Request, owner: Owner, action: (owner: Owner) => Promise<Response>) => action(owner), authenticate: vi.fn(async () => ({ id: "test-owner", auth: "cookie" })), checkOrigin: vi.fn(), checkClientRequest: vi.fn(), mintCredential: vi.fn(), revokeTokens: vi.fn(), COOKIE: "hello_identity" }));
beforeEach(() => vi.clearAllMocks());
it.each([413, 429])("导出异步错误 %s 返回真实状态与 JSON 原因，而不是未捕获的 500", async (status) => {
  service.exportData.mockRejectedValue(new AppError(status, "export was not created"));
  const response = await GET(new Request("http://localhost/api/hello/privacy/export"), { params: Promise.resolve({ path: ["privacy", "export"] }) });
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Disposition")).toBeNull();
  expect(await response.json()).toEqual({ error: "export was not created" });
});
it("隐私操作与恢复的异步拒绝也保留可恢复的错误状态", async () => {
  service.withdraw.mockRejectedValue(new AppError(409, "deletion in progress"));
  const withdrawn = await POST(new Request("http://localhost/api/hello/privacy/withdraw", { method: "POST" }), { params: Promise.resolve({ path: ["privacy", "withdraw"] }) });
  expect(withdrawn.status).toBe(409);
  service.recoverOwner.mockRejectedValue(new AppError(401, "invalid recovery code"));
  const recovered = await POST(new Request("http://localhost/api/hello/privacy-recover", { method: "POST", body: JSON.stringify({ code: "a".repeat(43) }) }), { params: Promise.resolve({ path: ["privacy-recover"] }) });
  expect(recovered.status).toBe(401);
});
