import { afterEach, expect, it, vi } from "vitest";
import { extractDocument } from "./knowledge-document";

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("unpdf", () => ({
  getResolvedPDFJS: async () => pdf,
  getDocumentProxy: async () => pdf.getDocument().promise,
}));
afterEach(() => vi.resetAllMocks());

it.each(["initialization", "page", "text"])(
  "cancels pending PDF %s without waiting for parser cleanup",
  async (stage) => {
    const pending = new Promise<never>(() => {});
    const destroy = vi.fn(() => pending);
    const getTextContent = vi.fn(() => pending);
    const getPage = vi.fn(() =>
      stage === "page" ? pending : Promise.resolve({ getTextContent }),
    );
    pdf.getDocument.mockReturnValue({
      promise:
        stage === "initialization"
          ? pending
          : Promise.resolve({ numPages: 1, getPage, loadingTask: { destroy } }),
      destroy,
    });
    const controller = new AbortController();
    const outcome = extractDocument(
      new TextEncoder().encode("%PDF-test"),
      "application/pdf",
      1,
      controller.signal,
    ).then(
      () => "returned text",
      (error: unknown) => error,
    );
    await vi.waitFor(() =>
      expect(
        stage === "initialization"
          ? pdf.getDocument
          : stage === "page"
            ? getPage
            : getTextContent,
      ).toHaveBeenCalled(),
    );
    const reason = new Error("knowledge deadline exceeded");
    controller.abort(reason);
    expect(
      await Promise.race([
        outcome,
        new Promise((resolve) => setTimeout(() => resolve("still pending"), 50)),
      ]),
    ).toBe(reason);
    expect(destroy).toHaveBeenCalledTimes(1);
  },
);
