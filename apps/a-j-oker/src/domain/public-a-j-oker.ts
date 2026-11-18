import { publicImageState } from "../images/service";
import { publicSpecialistState, specialistStateSchema } from "../agent/specialist-state";

// One boundary projection for every public transport. Persisted specialist
// snapshots intentionally remain private and richer than this result.
type PublicAJokerRow<T> = Omit<T, "imageGeneration" | "specialist" | "owner" | "requestKey" | "fingerprint"> & {
  imageGeneration?: { status: "submitting" | "pending" | "stored" | "failed" | "blocked"; canResume: boolean };
  specialist?: ReturnType<typeof publicSpecialistState>;
};

export function publicAJokerState<
  T extends { imageGeneration?: unknown; status?: string; visibility?: string; specialist?: unknown; handoffPreamble?: unknown },
>(row: T): PublicAJokerRow<T> {
  const projected = publicImageState(row) as Omit<T, "imageGeneration"> & {
    imageGeneration?: PublicAJokerRow<T>["imageGeneration"];
  };
  const {
    owner: _owner,
    requestKey: _requestKey,
    fingerprint: _fingerprint,
    ...withoutInternals
  } = projected as typeof projected & {
    owner?: unknown;
    requestKey?: unknown;
    fingerprint?: unknown;
  };
  if (withoutInternals.visibility === "quarantined") {
    const { handoffPreamble: _withheld, ...safe } = withoutInternals;
    return safe as PublicAJokerRow<T>;
  }
  if (!withoutInternals.specialist) return withoutInternals as PublicAJokerRow<T>;
  const parsed = specialistStateSchema.safeParse(withoutInternals.specialist);
  if (!parsed.success) {
    const { specialist: _malformed, ...safe } = withoutInternals;
    return safe as PublicAJokerRow<T>;
  }
  return { ...withoutInternals, specialist: publicSpecialistState(parsed.data) } as PublicAJokerRow<T>;
}
