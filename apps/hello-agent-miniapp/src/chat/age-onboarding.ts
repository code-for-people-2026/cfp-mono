import type { AgeDeclaration, AgeStatus } from "@cfp/hello-agent-protocol";

// Match the service's China-facing date, independently of the device's timezone.
export function todayInChina(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function declarationForBirthday(birthday: string, today = todayInChina()): AgeDeclaration | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || birthday < "1900-01-01" || birthday > today) return;
  const date = new Date(`${birthday}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== birthday) return;
  const age = Number(today.slice(0, 4)) - Number(birthday.slice(0, 4)) - (today.slice(5) < birthday.slice(5) ? 1 : 0);
  return age < 14 ? "under14" : age < 18 ? "14to17" : "adult";
}

export function ageGateStep(status?: AgeStatus, declaration?: AgeDeclaration) {
  if (!status) return "loading";
  if (!status.loggedIn) return "login";
  if (status.allowed) return "ready";
  if (status.state === "minor" || status.state === "needs_review" || declaration === "under14") return "blocked";
  if (status.state === "pending") return "pending";
  const selected = declaration || status.declaration;
  return selected && selected !== "unknown" ? "verify" : "birthday";
}
