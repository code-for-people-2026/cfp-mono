import { resolvePayloadRuntimeEnvironment } from "../src/payload/runtime-environment.mjs";

resolvePayloadRuntimeEnvironment({
  ...process.env,
  CFP_WEBSITE_BUILD: undefined,
  NODE_ENV: "production",
});
