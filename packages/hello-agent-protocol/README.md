# Hello Agent protocol

Shared, browser-safe contracts for the Hello Agent backend and Taro clients. Owns validated response artifacts, A2UI v0.9.1 catalog/envelopes and the bounded surface reducer, user actions and AG-UI SSE framing. It has no model, storage, identity or server dependencies.

Public catalog identifier: `urn:cfp:hello-agent:catalog:1`. The server exposes its JSON Schema at `/api/hello/a2ui-catalog`. Components: `Column`, `Card`, `Text`, `Image`, `Table`, `Page`, `FormField`, `Button`. This is a custom catalog, not the full standard basic catalog. Form values use `/values/<fieldId>`; only explicit `submit_form` actions transmit them. Child references use the standard A2UI `ComponentId` / `ChildList` definitions.

The model produces `Reply` through the trusted save tool. `toA2ui(turnId, artifacts)` compiles saved artifacts into `createSurface`, `updateComponents` and `updateDataModel` messages. AG-UI carries each envelope in a `CUSTOM` event named `a2ui`. `applyA2ui` and `createRunReader` are the client interfaces; neither executes generated code. `deleteSurface` and bounded data updates are supported by the reducer. Old replies with no artifacts compile to no surfaces.

Run `pnpm --filter @cfp/hello-agent-protocol test` for upstream-schema conformance, malformed content, form validation and interrupted/chunked transport checks.
