import { ACTIVITY_TYPES, type RecordEvent, type RecordSummary } from "../../src/model/types";

export function recordEventFixture(overrides: Partial<RecordEvent> = {}): RecordEvent {
  return { id: "event", legacyId: "activity", babyId: "baby-1", version: 1, progress: "ended", currentProgress: "ended", projection: "synced", complete: true,
    states: {}, missing: [], conflicts: [], sources: [], attachmentIds: [], ...overrides };
}

export function emptyRecordSummary(): RecordSummary {
  return { metrics: { sleepCount: 0, totalSleepMinutes: 0, breastfeedCount: 0, totalBreastfeedMinutes: 0, bottleCount: 0, totalMilkAmount: 0,
    pumpCount: 0, totalPumpMilkAmount: 0, diaperCount: 0, poopCount: 0, peeCount: 0, exerciseCount: 0, totalHeadLiftMinutes: 0,
    supplementADCount: 0, supplementD3Count: 0, supplementProbioticsCount: 0, supplementPrebioticsCount: 0, spitUpCount: 0, projectileSpitUpCount: 0 },
    coverage: { recordedEvents: 0, incompleteEvents: 0, pendingFields: 0, unknownFields: 0, ongoingEvents: 0, pendingCandidates: 0,
      duplicateCandidates: 0, unresolvedTime: 0, knownMilkAmounts: 0, unknownMilkAmounts: 0, knownZeroMilkAmounts: 0, eventsWithUnknownFields: [], pendingEventIds: [] },
    byType: Object.fromEntries(ACTIVITY_TYPES.map(type => [type, { events: 0, knownMinutes: 0, knownCount: 0, unknownCount: 0, knownMilkAmount: 0,
      preparedMilkAmount: 0, knownMilkAmounts: 0, unknownMilkAmounts: 0, knownDurations: 0, unknownDurations: 0, ongoingEvents: 0 }])) };
}
