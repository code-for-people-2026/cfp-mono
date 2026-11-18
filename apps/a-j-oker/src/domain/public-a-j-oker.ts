import { publicImageState } from "../images/service";
import { publicSpecialistState, specialistStateSchema } from "../agent/specialist-state";

// One boundary projection for every public transport. Persisted specialist
// snapshots intentionally remain private and richer than this result.
type PublicAJokerRow<T> = Omit<T, "imageGeneration" | "specialist"> & {
  imageGeneration?: { status: "submitting" | "pending" | "stored" | "failed" | "blocked"; canResume: boolean };
  specialist?: ReturnType<typeof publicSpecialistState>;
};

export function publicAJokerState<
  T extends { imageGeneration?: unknown; status?: string; visibility?: string; specialist?: unknown; handoffPreamble?: unknown },
>(row: T): PublicAJokerRow<T> {
  const projected = publicImageState(row) as Omit<T, "imageGeneration"> & {
    imageGeneration?: PublicAJokerRow<T>["imageGeneration"];
  };
  if (projected.visibility === "quarantined") {
    const { handoffPreamble: _withheld, ...safe } = projected;
    return safe as PublicAJokerRow<T>;
  }
  if (!projected.specialist) return projected as PublicAJokerRow<T>;
  const parsed = specialistStateSchema.safeParse(projected.specialist);
  if (!parsed.success) {
    const { specialist: _malformed, ...safe } = projected;
    return safe as PublicAJokerRow<T>;
  }
  return { ...projected, specialist: publicSpecialistState(parsed.data) } as PublicAJokerRow<T>;
}
