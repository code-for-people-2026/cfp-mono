# A2UI conformance fixtures

Unmodified A2UI v0.9.1 JSON schemas retrieved on 2026-10-10 from [a2ui-project/a2ui](https://github.com/a2ui-project/a2ui/tree/main/specification/v0_9_1/json). Their upstream `$id` intentionally retains the v0_9 family URI. Licensed under Apache-2.0; the upstream license is included in this directory.

`src/protocol.test.ts` validates the application's envelopes and actions against these schemas, with the declared custom catalog substituted for `catalog.json`. Production accepts only the bounded catalog and data paths exported from `src/a2ui.ts`; these fixtures do not claim support for the full basic catalog, arbitrary client functions or A2UI v1.0 candidate features.
