import { closeSync, existsSync, openSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, fsyncSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type MeasuredUsage = { prompt: number; completion: number; hit: number; miss: number };
// Official CNY peak prices checked 2026-10-27. No off-peak discount assumed.
export function measuredPeakCny(usage: MeasuredUsage) {
  if (!usage || ![usage.prompt, usage.completion, usage.hit, usage.miss].every(x => Number.isSafeInteger(x) && x >= 0) || usage.hit + usage.miss !== usage.prompt) throw new Error("Invalid measured usage");
  return Math.ceil((usage.hit * 0.04 + usage.miss * 2 + usage.completion * 8) * 100) / 100_000_000;
}

export function reserveForRequest(body: string) {
  const request = JSON.parse(body);
  if (request.model !== "deepseek-flash" || !Number.isInteger(request.max_tokens) || request.max_tokens <= 0 || request.max_tokens > 8192 || request.stream !== false || request.thinking?.type !== "disabled") throw new Error("Unsupported paid request");
  // UTF-8 byte count plus protocol margin bounds text token input conservatively.
  if (request.messages?.some((m: { content?: unknown }) => Array.isArray(m.content) && m.content.some((c: { type?: string }) => c.type === "image_url"))) throw new Error("Image understanding requires its own verified reservation");
  return Math.ceil(((Buffer.byteLength(body) * 2 + 8192) * 2 + request.max_tokens * 8) / 1e6 * 1e6) / 1e6;
}

/** Existing cumulative reservation is the floor; no reset/release after failures.
 * A successful request may replace its reservation with verified peak-priced
 * usage, retaining an append-only evidence hash. Unknown costs remain reserved.
 * Every reservation is fsynced before the request. A process-wide lock prevents
 * concurrent live runs sharing this ledger; a stale lock must be investigated. */
export function openBudget(priorPath: string, stopCny = 45) {
  priorPath = realpathSync(priorPath);
  const journalPath = `${priorPath}.continuation.jsonl`;
  if (!Number.isFinite(stopCny) || stopCny > 50 || stopCny <= 0) throw new Error("Invalid stop line");
  const prior = JSON.parse(readFileSync(priorPath, "utf8"));
  if (prior.capCny !== 50 || prior.stopCny !== 45 || !Number.isFinite(prior.reserved) || prior.reserved < 0) throw new Error("Missing or invalid cumulative budget");
  const lockPath = `${priorPath}.live.lock`;
  const lock = openSync(lockPath, "wx", 0o600);
  writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), journalPath })); fsyncSync(lock);
  let total = prior.reserved;
  const reservations = new Map<string, { amount: number; settled: boolean; caseId: string }>();
  type Settlement = { event: "settle"; id: string; caseId: string; status: number; model: string; usage: MeasuredUsage; evidenceSha256: string; amount: number };
  const validateSettlement = (entry: Settlement) => {
    const reservation = reservations.get(entry.id);
    if (!reservation || reservation.settled || reservation.caseId !== entry.caseId || entry.status !== 200 || entry.model !== "deepseek-flash" || !/^[a-f0-9]{64}$/.test(entry.evidenceSha256) || entry.amount !== measuredPeakCny(entry.usage) || entry.amount > reservation.amount) throw new Error("Invalid or duplicate usage settlement");
    return reservation;
  };
  try {
    if (existsSync(journalPath)) for (const line of readFileSync(journalPath, "utf8").trim().split("\n").filter(Boolean)) {
      const entry = JSON.parse(line);
      if (entry.event === "reserve") {
        if (typeof entry.id !== "string" || reservations.has(entry.id) || !Number.isFinite(entry.amount) || entry.amount <= 0) throw new Error("Invalid reservation journal");
        reservations.set(entry.id, { amount: entry.amount, settled: false, caseId: entry.caseId });
        total += entry.amount;
      } else if (entry.event === "settle") {
        const reservation = validateSettlement(entry);
        total -= reservation.amount - entry.amount; reservation.settled = true;
      } else throw new Error("Invalid reservation journal");
    }
  } catch (error) { closeSync(lock); unlinkSync(lockPath); throw error; }
  return {
    get total() { return total; },
    reserve(amount: number, caseId: string) {
      if (!Number.isFinite(amount) || amount <= 0 || total + amount > stopCny) throw new Error("Cumulative budget stop");
      const id = randomUUID(), fd = openSync(journalPath, "a", 0o600);
      try { appendFileSync(fd, JSON.stringify({ event: "reserve", id, at: new Date().toISOString(), caseId, amount }) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
      reservations.set(id, { amount, settled: false, caseId });
      total += amount; return id;
    },
    settle(entry: Omit<Settlement, "event" | "amount">) {
      const event: Settlement = { ...entry, event: "settle", amount: measuredPeakCny(entry.usage) };
      const reservation = validateSettlement(event), fd = openSync(journalPath, "a", 0o600);
      try { appendFileSync(fd, JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
      total -= reservation.amount - event.amount; reservation.settled = true;
    },
    close() { closeSync(lock); unlinkSync(lockPath); },
  };
}
