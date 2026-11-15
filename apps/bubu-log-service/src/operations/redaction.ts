/** Safe for operational receipts, native list views and audit. Raw credentials never belong here. */
export function redactOperations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOperations);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/token|password|secret|credential|session|hash|salt|authorization|cookie|fingerprint|^(path|filePath|storagePath|root|directory)$/i.test(key)) continue;
    result[key] = redactOperations(child);
  }
  return result;
}
export function safeDocument(value: Record<string, unknown>): Record<string, unknown> {
  return redactOperations(value) as Record<string, unknown>;
}
/** Ordinary Admin/REST/GraphQL reads are metadata only; source bodies require the audited ops read action. */
export function operationSummary(value: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const name of ["id", "babyId", "eventId", "jobId", "batchId", "version", "eventVersion", "state", "status", "progress", "lifecycle", "projection", "complete", "enabled", "intervalMs", "attempts", "pendingMedia", "mediaPending", "createdAt", "updatedAt", "at", "startedAt", "heartbeatAt", "lastSuccessAt", "processedThrough", "nextRunAt", "mimeType", "size"]) {
    if (["string", "number", "boolean"].includes(typeof value[name])) summary[name] = value[name];
  }
  if (value.facts && typeof value.facts === "object") {
    const facts = value.facts as Record<string, unknown>;
    for (const name of ["type", "startTime"]) if (typeof facts[name] === "string") summary[name] = facts[name];
  }
  for (const name of ["fields", "missing"]) if (Array.isArray(value[name])) summary[name] = value[name].filter(item => typeof item === "string");
  for (const name of ["sources", "attachmentIds", "conflicts", "duplicateCandidates", "messages", "backfills", "eventIds", "media"]) if (Array.isArray(value[name])) summary[`${name}Count`] = value[name].length;
  if (value.failure && typeof value.failure === "object") {
    const failure = value.failure as Record<string, unknown>;
    summary.failure = Object.fromEntries(["code", "at", "attempts"].filter(name => ["string", "number"].includes(typeof failure[name])).map(name => [name, failure[name]]));
  }
  return summary;
}
