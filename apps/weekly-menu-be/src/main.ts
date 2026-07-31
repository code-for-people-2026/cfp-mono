import { startWeeklyMenuRuntime } from "./runtime";

try {
  const runtime = await startWeeklyMenuRuntime();
  console.log(JSON.stringify({ event: "server_started", port: runtime.port }));
} catch {
  // Configuration and dependency errors may include credentials or URLs.
  console.error(JSON.stringify({ event: "server_start_failed" }));
  process.exitCode = 1;
}
