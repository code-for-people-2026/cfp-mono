// The shared platform quota reserves this worst-case call count before a run.
// Keep the runner and specialist fan-out limits tied to the same constants.
export const COORDINATOR_MAX_CALLS = 5;
export const SPECIALIST_MAX_CALLS = 2;
export const MAX_SPECIALISTS = 2;
export const GREETING_MAX_CALLS =
  COORDINATOR_MAX_CALLS + MAX_SPECIALISTS * SPECIALIST_MAX_CALLS;
