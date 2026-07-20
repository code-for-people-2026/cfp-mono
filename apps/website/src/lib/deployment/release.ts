type Environment = Record<string, string | undefined>;

const commitShaPattern = /^[0-9a-f]{40}$/;

export function resolveReleaseSha(environment: Environment = process.env): string {
  const releaseSha = [environment.RELEASE_SHA, environment.VERCEL_GIT_COMMIT_SHA].find(
    (candidate) => candidate && commitShaPattern.test(candidate),
  );
  return releaseSha ?? "unknown";
}
