import { startKithInnRuntime } from "./runtime";

try {
  await startKithInnRuntime();
  console.log(JSON.stringify({ event: "server_started" }));
} catch {
  console.error(JSON.stringify({ event: "server_start_failed" }));
  process.exitCode = 1;
}
