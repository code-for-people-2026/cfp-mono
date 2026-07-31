export type ChecklistLocalStorage = Readonly<{
  get(key: string): unknown;
  set(key: string, value: string[]): void;
}>;

function storageKey(planId: string): string {
  return `weekly-menu:checklist:${planId}`;
}

export function readCheckedDishNames(
  planId: string,
  availableNames: readonly string[],
  storage: ChecklistLocalStorage
): Set<string> {
  const stored = storage.get(storageKey(planId));
  if (!Array.isArray(stored)) {
    return new Set();
  }
  const available = new Set(availableNames);
  return new Set(
    stored.filter(
      (name): name is string => typeof name === "string" && available.has(name)
    )
  );
}

export function writeCheckedDishNames(
  planId: string,
  availableNames: readonly string[],
  checkedNames: ReadonlySet<string>,
  storage: ChecklistLocalStorage
): void {
  storage.set(
    storageKey(planId),
    availableNames.filter((name) => checkedNames.has(name))
  );
}
