export const ACTIVITY_TYPES = [
  "SLEEP", "DIAPER", "BREASTFEED", "BOTTLE", "PUMP", "HEAD_LIFT",
  "PASSIVE_EXERCISE", "ROLL_OVER", "PULL_TO_SIT", "GAS_EXERCISE",
  "BATH", "OUTDOOR", "EARLY_EDUCATION", "SUPPLEMENT", "SPIT_UP",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type MilkSource = "BREAST_MILK" | "FORMULA";
export type BreastFirmness = "SOFT" | "ELASTIC" | "HARD";
export type PoopColor = "YELLOW" | "GREEN" | "BROWN" | "BLACK" | "WHITE" | "RED";
export type PeeAmount = "SMALL" | "MEDIUM" | "LARGE";
export type SupplementType = "AD" | "D3" | "PROBIOTICS" | "PREBIOTICS";
export type SpitUpType = "NORMAL" | "PROJECTILE";
export type DateInput = Date | string | number;

/** The existing Payload Activity read shape. No new persisted fields. */
export interface Activity {
  id: string;
  type: ActivityType;
  startTime: string;
  endTime?: string | null;
  babyId?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  hasPoop?: boolean | null;
  hasPee?: boolean | null;
  poopColor?: PoopColor | null;
  poopPhotoUrl?: string | null;
  peeAmount?: PeeAmount | null;
  burpSuccess?: boolean | null;
  milkAmount?: number | null;
  milkSource?: MilkSource | null;
  breastFirmness?: BreastFirmness | null;
  supplementType?: SupplementType | null;
  spitUpType?: SpitUpType | null;
  count?: number | null;
  notes?: string | null;
}

export interface Baby {
  id: string;
  name: string;
  fullName?: string | null;
  avatarUrl?: string | null;
  birthDate?: string | null;
  gender?: "BOY" | "GIRL" | "OTHER" | null;
  isDefault?: boolean;
}

export interface AuthContext {
  authenticated: boolean;
  hasBaby: boolean;
  baby: Baby | null;
  babies: Baby[];
  defaultBabyId?: string | null;
  code?: string;
  /** Present for the independent identity service, absent in legacy mode. */
  identityId?: string;
  legacyLinked?: boolean;
}

/** DailyStats is read as calculated by the existing server, never recomputed here. */
export interface DailyStat {
  id: string;
  date: string;
  babyId?: string;
  sleepCount: number;
  totalSleepMinutes: number;
  breastfeedCount?: number;
  totalBreastfeedMinutes?: number;
  bottleCount?: number;
  totalMilkAmount: number;
  pumpCount?: number;
  totalPumpMilkAmount: number;
  diaperCount: number;
  poopCount?: number;
  peeCount?: number;
  exerciseCount?: number;
  totalHeadLiftMinutes?: number;
  supplementADCount?: number;
  supplementD3Count?: number;
  supplementProbioticsCount?: number;
  supplementPrebioticsCount?: number;
  spitUpCount?: number;
  projectileSpitUpCount?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Present only in sidecar mode; separate from the original DailyStat metrics. */
  coverage?: RecordCoverage;
  byType?: Record<string, RecordTypeSummary>;
}

export interface RecordCoverage {
  recordedEvents: number; incompleteEvents: number; pendingFields: number; unknownFields: number;
  ongoingEvents: number; pendingCandidates: number; duplicateCandidates: number; unresolvedTime: number;
  knownMilkAmounts: number; unknownMilkAmounts: number; knownZeroMilkAmounts: number;
  eventsWithUnknownFields: string[]; pendingEventIds: string[];
}
export interface RecordTypeSummary {
  events: number; knownMinutes: number; knownCount: number; unknownCount: number;
  knownMilkAmount: number; preparedMilkAmount: number; knownMilkAmounts: number;
  unknownMilkAmounts: number; knownDurations: number; unknownDurations: number; ongoingEvents: number;
}
export interface RecordSummary { metrics: Record<string, number>; coverage: RecordCoverage; byType: Record<string, RecordTypeSummary> }
export interface RecordEvent {
  id: string; babyId: string; legacyId: string; version: number;
  progress: "ongoing" | "ended" | "unknown"; projection: "candidate" | "pending" | "synced" | "conflict";
  currentProgress: "ongoing" | "ended" | "unknown";
  complete: boolean; states: Record<string, "known" | "pending" | "unknown" | "not_applicable" | "not_yet">;
  missing: string[]; conflicts: Array<{ code: string; fields: string[] }>;
  sources: Array<{ kind: "chat" | "wechat" | "manual"; sentAt: string }>;
  attachmentIds: string[];
}
export interface RecordCollection {
  activities: Activity[]; events: RecordEvent[];
  questions: Array<{ id: string; babyId: string; eventId: string; state: "open" | "resolved" | "dismissed" }>;
}
export interface RecordSnapshot extends RecordCollection { summary: RecordSummary }
export interface RecordSyncStatus {
  id: string; enabled: boolean; lastSuccessAt: string | null; processedThrough: string | null;
  pending: boolean; pendingMedia: number; failure: { code: string; at: string; attempts: number } | null;
}

export interface DaySummary {
  sleepCount: number;
  totalSleepMinutes: number;
  totalBottleMilkAmount: number;
  totalBreastfeedMinutes: number;
  totalPumpMilkAmount: number;
  diaperCount: number;
  largePeeDiaperCount: number;
  smallMediumPeeDiaperCount: number;
  totalOutdoorMinutes: number;
  totalHeadLiftMinutes: number;
  totalRollOverCount: number;
  totalPullToSitCount: number;
}

export const STAT_FILTERS = ["sleep", "bottle", "breastfeed", "pump", "diaper", "outdoor", "headLift", "rollOver"] as const;
export type StatFilter = (typeof STAT_FILTERS)[number];
export type SortField = "endTime" | "createdAt" | "updatedAt";
export type WeeklyFilter = "sleep" | "feeding" | "diaper" | "exercise";
