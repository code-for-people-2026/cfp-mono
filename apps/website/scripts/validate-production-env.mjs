import { resolvePayloadRuntimeEnvironment } from "../src/payload/runtime-environment.mjs";

resolvePayloadRuntimeEnvironment({
  ...process.env,
  NODE_ENV: "production",
});
