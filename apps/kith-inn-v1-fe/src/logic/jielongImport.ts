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
  if (!state.preview || state.confirmedPreviewHash !== state.preview.previewHash) return null;
  return client.commitJielongImport({
    text: state.text,
    previewHash: state.preview.previewHash,
    confirmed: true
  });
}

export function summarizeJielongCommit(response: JielongCommitResponse) {
  const summary = response.results.reduce((counts, result) => ({
    ...counts,
    [result.status]: counts[result.status] + 1
  }), { created: 0, existing: 0 });
  return { ...summary, total: response.results.length };
}
