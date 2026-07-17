import { describe, expect, it, vi } from "vitest";
import type { JielongCommitResponse, JielongPreviewResponse } from "@cfp/kith-inn-v1-shared";
import {
  applyJielongPreview,
  commitConfirmedJielongImport,
  createJielongImportState,
  setJielongConfirmed,
  setJielongText,
  summarizeJielongCommit
} from "./jielongImport";

const text = "2026-07-20 午餐\n1. 王阿姨 2份\n2. 李叔 1份";
const preview: JielongPreviewResponse = {
  previewHash: "a".repeat(64),
  target: { date: "2026-07-20", occasion: "lunch" },
  lines: [
    { lineNumber: 2, displayName: "王阿姨", quantity: 2, unitPriceCents: 3000, totalCents: 6000 },
    { lineNumber: 3, displayName: "李叔", quantity: 1, unitPriceCents: 3000, totalCents: 3000 }
  ],
  totalCents: 9000
};
const result: JielongCommitResponse = {
  previewHash: preview.previewHash,
  results: [
    { lineNumber: 2, status: "created", orderId: 31 },
    { lineNumber: 3, status: "existing", orderId: 32 }
  ]
};

describe("jielong import logic", () => {
  it("requires an explicit confirmation bound to the current preview hash", async () => {
    const commitJielongImport = vi.fn(async () => result);
    const empty = createJielongImportState();
    expect(setJielongConfirmed(empty, true)).toEqual(empty);
    await expect(commitConfirmedJielongImport({ commitJielongImport }, empty)).resolves.toBeNull();

    const staged = applyJielongPreview(text, preview);
    await expect(commitConfirmedJielongImport({ commitJielongImport }, staged)).resolves.toBeNull();
    const confirmed = setJielongConfirmed(staged, true);
    await expect(commitConfirmedJielongImport({ commitJielongImport }, confirmed)).resolves.toEqual(result);
    expect(commitJielongImport).toHaveBeenCalledOnce();
    expect(commitJielongImport).toHaveBeenCalledWith({
      text,
      previewHash: preview.previewHash,
      confirmed: true
    });
    expect(setJielongConfirmed(confirmed, false).confirmedPreviewHash).toBeNull();
  });

  it("keeps an unchanged draft but invalidates confirmation after text or hash changes", async () => {
    const commitJielongImport = vi.fn(async () => result);
    const confirmed = setJielongConfirmed(applyJielongPreview(text, preview), true);
    expect(setJielongText(confirmed, text)).toBe(confirmed);

    const changed = setJielongText(confirmed, `${text}\n2. 李叔 1份`);
    expect(changed).toMatchObject({ preview: null, confirmedPreviewHash: null });
    await expect(commitConfirmedJielongImport({ commitJielongImport }, changed)).resolves.toBeNull();

    const tampered = { ...confirmed, preview: { ...preview, previewHash: "b".repeat(64) } };
    await expect(commitConfirmedJielongImport({ commitJielongImport }, tampered)).resolves.toBeNull();
    expect(commitJielongImport).not.toHaveBeenCalled();
  });

  it("derives created and existing totals from a strict commit result", () => {
    expect(summarizeJielongCommit(result)).toEqual({ created: 1, existing: 1, total: 2 });
  });

  it("rejects commit results that do not match every confirmed preview line", async () => {
    const state = setJielongConfirmed(applyJielongPreview(text, preview), true);
    for (const incompatible of [
      { ...result, previewHash: "b".repeat(64) },
      { ...result, results: result.results.slice(0, 1) },
      { ...result, results: [{ ...result.results[0]!, lineNumber: 1 }, result.results[1]!] }
    ]) await expect(commitConfirmedJielongImport({
      commitJielongImport: vi.fn(async () => incompatible)
    }, state)).rejects.toThrow("接龙导入结果与确认预览不匹配");
  });
});
