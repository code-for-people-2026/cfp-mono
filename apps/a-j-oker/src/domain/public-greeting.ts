import { publicImageState } from "../images/service";
import { publicSpecialistState, specialistStateSchema } from "../agent/specialist-state";

// One boundary projection for every public transport. Persisted specialist
// snapshots intentionally remain private and richer than this result.
type PublicGreetingRow<T> = Omit<T, "imageGeneration" | "specialist"> & {
  imageGeneration?: { status: "submitting" | "pending" | "stored" | "failed" | "blocked"; canResume: boolean };
  specialist?: ReturnType<typeof publicSpecialistState>;
};

export function publicGreetingState<
  T extends { imageGeneration?: unknown; status?: string; visibility?: string; specialist?: unknown },
>(row: T): PublicGreetingRow<T> {
  const projected = publicImageState(row) as Omit<T, "imageGeneration"> & {
    imageGeneration?: PublicGreetingRow<T>["imageGeneration"];
  };
  if (!projected.specialist) return projected as PublicGreetingRow<T>;
  const parsed = specialistStateSchema.safeParse(projected.specialist);
  if (!parsed.success) {
    const { specialist: _malformed, ...safe } = projected;
    return safe as PublicGreetingRow<T>;
  }
  return { ...projected, specialist: publicSpecialistState(parsed.data) } as PublicGreetingRow<T>;
}
