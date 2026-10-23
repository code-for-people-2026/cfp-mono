import type { SanitizedConfig } from "payload";
import type { BubuRuntime } from "./runtime";

const key = Symbol.for("bubu.single-process-runtime.v1");
interface State { config: Promise<SanitizedConfig>; runtime?: BubuRuntime }
const globals = globalThis as typeof globalThis & { [key]?: State };
export function runtimeState(): State | undefined { return globals[key]; }
export function assertRuntimeAvailable() {
  if (!globals[key]?.runtime) throw new Error("Payload Admin requires the running Bubu service in this process.");
}
export function registerRuntimeState(state: State) {
  if (globals[key]) throw new Error("The Bubu runtime is already initialized in this process.");
  globals[key] = state;
}
export function clearRuntimeState() {
  // Payload 3.85.1 caches its default instance globally and destroy() leaves it cached.
  // Native routes must share that key; remove it only after the owning runtime closes.
  const cache = (globalThis as typeof globalThis & { _payload?: Map<string, { payload?: unknown }> })._payload;
  const instance = globals[key]?.runtime?.store.payload;
  if (!instance || cache?.get("default")?.payload === instance) cache?.delete("default");
  delete globals[key];
}
