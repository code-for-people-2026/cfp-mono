import { runtimeState } from "./src/runtime-state";
import { buildRuntimeConfig, operationsOrigin } from "./src/runtime-config";

// Schema inspection/build tools can load an inert in-memory config. Serving routes
// assert the running single-process owner before invoking any Payload handler.
export default runtimeState()?.config || buildRuntimeConfig({
  directory: ".",
  secret: "build-schema-only-never-used-for-a-running-service",
  origin: operationsOrigin(),
  schemaOnly: true,
});
