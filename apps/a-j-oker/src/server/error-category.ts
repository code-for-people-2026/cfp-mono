// Log only a fixed category, never exception messages, SQL parameters or provider
// responses: those can contain personal input and credentials.
export function errorCategory(error: unknown): string {
  const visited = new Set<unknown>();
  for (let cause = error; cause instanceof Error && !visited.has(cause); cause = cause.cause) {
    visited.add(cause);
    const code = "code" in cause ? cause.code : undefined;
    if (code === "SQLITE_BUSY" || /\bSQLITE_BUSY:/.test(cause.message)) return "sqlite_busy";
    if (code === "SQLITE_LOCKED") return "sqlite_locked";
    if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") return "sqlite_corrupt";
    if (code === "SQLITE_IOERR" || code === "SQLITE_FULL") return "sqlite_storage";
  }
  return "unclassified";
}
