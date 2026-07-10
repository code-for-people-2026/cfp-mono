import type {
  ImportCommitInput,
  ImportCommitResponse,
  ImportPreviewResponse,
  Offering
} from "@cfp/kith-inn-v1-shared";

export function partitionOfferings(offerings: Offering[]) {
  const byName = (left: Offering, right: Offering) => left.name.localeCompare(right.name, "zh-CN");
  return {
    active: offerings.filter((offering) => offering.active).sort(byName),
    inactive: offerings.filter((offering) => !offering.active).sort(byName)
  };
}

export function previewSummaryText(preview: Pick<ImportPreviewResponse, "summary">): string {
  const { ready, conflict, invalid } = preview.summary;
  return `可新增 ${ready} 行，重名 ${conflict} 行，错误 ${invalid} 行`;
}

export function commitSummaryText(commit: Pick<ImportCommitResponse, "summary">): string {
  const { created, overwritten, skipped, failed } = commit.summary;
  return `新增 ${created} 行，覆盖 ${overwritten} 行，跳过 ${skipped} 行，失败 ${failed} 行`;
}

export function commitResultText(result: ImportCommitResponse["results"][number]): string {
  if (result.status === "failed") return `失败：${result.error}`;
  return {
    created: "新增成功",
    overwritten: "覆盖成功",
    skipped: "已跳过"
  }[result.status];
}

export function setConflictAction(
  conflicts: ImportCommitInput["conflicts"],
  line: number,
  action: "skip" | "overwrite"
): ImportCommitInput["conflicts"] {
  const remaining = conflicts.filter((conflict) => conflict.line !== line);
  return action === "overwrite" ? [...remaining, { line, action }] : remaining;
}
