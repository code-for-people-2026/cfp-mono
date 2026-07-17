import type {
  JielongCommitInput,
  JielongCommitResponse,
  JielongPreviewResponse
} from "@cfp/kith-inn-v1-shared";

export type JielongImportState = {
  text: string;
  preview: JielongPreviewResponse | null;
  confirmedPreviewHash: string | null;
};

type JielongCommitter = {
  commitJielongImport(input: JielongCommitInput): Promise<JielongCommitResponse>;
};

export function jielongImportEnabled(value: string | undefined): boolean {
  return value === "1";
}

export type JielongImportActivity = "idle" | "previewing" | "committing";
export function jielongImportPageNotice(activity: JielongImportActivity, text: string, error: string): string | null {
  if (error) return error;
  if (activity === "previewing") return "正在解析接龙文本…";
  if (activity === "committing") return "正在写入草稿订单…";
  return text.trim() ? null : "请粘贴接龙文本后预览";
}

export function createJielongImportState(): JielongImportState {
  return { text: "", preview: null, confirmedPreviewHash: null };
}

export function setJielongText(state: JielongImportState, text: string): JielongImportState {
  if (text === state.text) return state;
  return { text, preview: null, confirmedPreviewHash: null };
}

export function applyJielongPreview(text: string, preview: JielongPreviewResponse): JielongImportState {
  return { text, preview, confirmedPreviewHash: null };
}

export function setJielongConfirmed(state: JielongImportState, confirmed: boolean): JielongImportState {
  if (!confirmed || !state.preview) return { ...state, confirmedPreviewHash: null };
  return { ...state, confirmedPreviewHash: state.preview.previewHash };
}

export async function commitConfirmedJielongImport(
  client: JielongCommitter,
  state: JielongImportState
): Promise<JielongCommitResponse | null> {
  const preview = state.preview;
  if (!preview || state.confirmedPreviewHash !== preview.previewHash) return null;
  const response = await client.commitJielongImport({
    text: state.text,
    previewHash: preview.previewHash,
    confirmed: true
  });
  if (response.previewHash !== preview.previewHash || response.results.length !== preview.lines.length ||
    response.results.some((result, index) => result.lineNumber !== preview.lines[index]!.lineNumber)) {
    throw new Error("接龙导入结果与确认预览不匹配");
  }
  return response;
}

export function summarizeJielongCommit(response: JielongCommitResponse) {
  const summary = response.results.reduce((counts, result) => ({
    ...counts,
    [result.status]: counts[result.status] + 1
  }), { created: 0, existing: 0 });
  return { ...summary, total: response.results.length };
}
