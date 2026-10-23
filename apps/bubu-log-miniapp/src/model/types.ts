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
