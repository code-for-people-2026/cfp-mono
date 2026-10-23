import type { ActorScope } from "../identity";

export const activityTypes = ["BREASTFEED", "BOTTLE", "PUMP", "SLEEP", "DIAPER", "HEAD_LIFT", "PASSIVE_EXERCISE", "GAS_EXERCISE", "BATH", "OUTDOOR", "EARLY_EDUCATION", "ROLL_OVER", "PULL_TO_SIT", "SUPPLEMENT", "SPIT_UP"] as const;
export type ActivityType = typeof activityTypes[number];
export type FieldState = "known" | "pending" | "unknown" | "not_applicable" | "not_yet";
export type Progress = "ongoing" | "ended" | "unknown";
export interface Facts {
  type?: ActivityType; startTime?: string; endTime?: string | null; durationMinutes?: number;
  milkAmount?: number | null; milkSource?: "BREAST_MILK" | "FORMULA";
  preparedMilkAmount?: number | null; remainingMilkAmount?: number | null; sameBottle?: boolean;
  burpSuccess?: boolean | null; breastFirmness?: "SOFT" | "ELASTIC" | "HARD";
  hasPoop?: boolean | null; hasPee?: boolean | null;
  poopColor?: "YELLOW" | "GREEN" | "BROWN" | "BLACK" | "WHITE" | "RED";
  poopPhotoUrl?: string | null; peeAmount?: "SMALL" | "MEDIUM" | "LARGE";
  count?: number | null; supplementType?: "AD" | "D3" | "PROBIOTICS" | "PREBIOTICS";
  spitUpType?: "NORMAL" | "PROJECTILE"; notes?: string | null;
}
export type Field = keyof Facts;
export interface SourceRef {
  kind: "chat" | "wechat" | "manual"; accountId: string; conversationId: string;
  messageId: string; eventKey: string; sentAt: string; senderId: string;
  collectedAt?: string; groupId?: string; mediaIds?: string[];
}
export interface Evidence { field: Field; kind: "reported" | "image" | "extracted" | "calculated"; sourceKey?: string; detail?: string; confirmed: boolean }
export interface RuleInput { facts: Facts; states?: Partial<Record<Field, FieldState>>; progress?: Progress; intent?: "feeding"; evidence?: Evidence[] }
export interface RuleIssue { code: string; fields: Field[]; message: string; relatedEventId?: string }
export interface RuleResult { facts: Facts; states: Partial<Record<Field, FieldState>>; progress: Progress; missing: Field[]; conflicts: RuleIssue[]; complete: boolean; evidence: Evidence[] }
export interface LegacyActivity extends Facts { id: string; babyId: string; type: ActivityType; startTime: string; createdAt?: string; updatedAt?: string }
export type DailyMetrics = Record<string, number>;
export interface LegacyRecordsBackend {
  listActivities(babyId: string): Promise<LegacyActivity[]>;
  getActivity(babyId: string, id: string): Promise<LegacyActivity | null>;
  /** Check observed old-site changes; remote REST selection is not atomic CAS. null means create only. */
  writeActivity(babyId: string, id: string, desired: LegacyActivity | null, expected: LegacyActivity | null): Promise<LegacyActivity | null>;
  saveDailyStats(babyId: string, date: string, metrics: DailyMetrics): Promise<void>;
}
export interface CareEvent {
  id: string; babyId: string; legacyId: string; version: number; facts: Facts;
  states: Partial<Record<Field, FieldState>>; progress: Progress; intent?: "feeding";
  evidence: Evidence[]; missing: Field[]; conflicts: RuleIssue[]; complete: boolean;
  lifecycle: "active" | "retracted" | "merged"; duplicateCandidates: string[]; mergedInto?: string;
  distinctFrom?: string[];
  confirmedOverlaps?: Record<string,string>;
  sources: SourceRef[]; attachmentIds: string[]; actor: ActorScope["actor"];
  projection: "candidate" | "pending" | "synced" | "conflict";
  projected: LegacyActivity | null; createdAt: string; updatedAt: string;
}
export interface PendingQuestion {
  id: string; babyId: string; eventId: string; version: number; eventVersion: number;
  fields: Field[]; conflicts: RuleIssue[]; duplicateCandidates: string[];
  state: "open" | "resolved" | "dismissed"; updatedAt: string;
}
export interface EventInput extends RuleInput { sources?: SourceRef[]; attachmentIds?: string[] }
export interface RecordReceipt { requestId: string; status: "saved" | "needs_information" | "pending_projection" | "conflict"; events: CareEvent[]; questions: PendingQuestion[]; retryable: boolean }
