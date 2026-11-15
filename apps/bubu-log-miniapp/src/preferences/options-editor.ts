import type { CarePreferencesView, PreferenceKey, PreferenceUpdate } from "./shared-options";

export type PreferenceDraft = Partial<Record<PreferenceKey, number[]>>;

export function draftFromPreferences(preferences: CarePreferencesView): PreferenceDraft {
  return Object.fromEntries(preferences.options.map(option => [option.key, [...option.configuredValues]])) as PreferenceDraft;
}

function replace(draft: PreferenceDraft, key: PreferenceKey, values: number[]): PreferenceDraft {
  return { ...draft, [key]: values };
}
export function addPreferenceValue(draft: PreferenceDraft, key: PreferenceKey, value: number): PreferenceDraft {
  return replace(draft, key, [...(draft[key] ?? []), value]);
}
export function editPreferenceValue(draft: PreferenceDraft, key: PreferenceKey, index: number, value: number): PreferenceDraft {
  const values = [...(draft[key] ?? [])];
  if (index < 0 || index >= values.length) return draft;
  values[index] = value;
  return replace(draft, key, values);
}
export function deletePreferenceValue(draft: PreferenceDraft, key: PreferenceKey, index: number): PreferenceDraft {
  const values = [...(draft[key] ?? [])];
  if (index < 0 || index >= values.length) return draft;
  values.splice(index, 1);
  return replace(draft, key, values);
}
export function movePreferenceValue(draft: PreferenceDraft, key: PreferenceKey, index: number, direction: -1 | 1): PreferenceDraft {
  const values = [...(draft[key] ?? [])];
  const destination = index + direction;
  if (index < 0 || destination < 0 || index >= values.length || destination >= values.length) return draft;
  [values[index], values[destination]] = [values[destination]!, values[index]!];
  return replace(draft, key, values);
}
export function clearPreferenceValues(draft: PreferenceDraft, key: PreferenceKey): PreferenceDraft {
  return replace(draft, key, []);
}
const equal = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((value, index) => value === right[index]);

export function changedPreferenceUpdates(preferences: CarePreferencesView, draft: PreferenceDraft): PreferenceUpdate[] {
  return preferences.options.flatMap(option => {
    const values = draft[option.key] ?? [];
    return equal(values, option.configuredValues) ? [] : [{ key: option.key, values: [...values] }];
  });
}

/** Keeps only locally changed keys while accepting unrelated caregiver changes from a fresh read. */
export function reconcilePreferenceDraft(previous: CarePreferencesView, draft: PreferenceDraft, latest: CarePreferencesView): PreferenceDraft {
  if (previous.babyId !== latest.babyId) return draftFromPreferences(latest);
  const changed = new Map(changedPreferenceUpdates(previous, draft).map(update => [update.key, update.values]));
  const result = draftFromPreferences(latest);
  for (const [key, values] of changed) if (latest.options.some(option => option.key === key)) result[key] = [...values];
  return result;
}

export function newPreferenceRequestId(): string {
  return `prefs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Reuses an id only when retrying exactly the same observed version and updates. */
export class PreferenceRequestTracker {
  private current?: { signature: string; requestId: string };
  requestId(expectedVersion: number, updates: PreferenceUpdate[]): string {
    const signature = JSON.stringify({ expectedVersion, updates });
    if (this.current?.signature === signature) return this.current.requestId;
    const requestId = newPreferenceRequestId();
    this.current = { signature, requestId };
    return requestId;
  }
  clear(): void { this.current = undefined; }
}
