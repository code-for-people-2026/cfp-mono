# base-chat-protocol

Shared, browser-safe reply and presentation protocol used by the a-j-oker backend and Taro clients. Owns validated response artifacts, A2UI v0.9.1 catalog/envelopes and bounded message validation, user actions and AG-UI SSE framing. AG-UI event framing and A2UI presentation both belong here. It has no model, storage, identity or server dependencies. Product API contracts, age verification, consent and complaints belong to `@cfp/a-j-oker-contracts`; this package must not depend on that business package.

Public catalog identifier: `urn:cfp:hello-agent:catalog:1`. The server exposes its JSON Schema at `/api/hello/a2ui-catalog`. Components: `Column`, `Card`, `Text`, `Image`, `Table`, `Page`, `FormField`, `Button`. This is a custom catalog, not the full standard basic catalog. Form values use `/values/<fieldId>`; only explicit `submit_form` actions transmit them. Child references use the standard A2UI `ComponentId` / `ChildList` definitions.

The model produces `Reply` through the trusted save tool. `toA2ui(turnId, artifacts)` compiles saved artifacts into `createSurface`, `updateComponents` and `updateDataModel` messages. AG-UI carries each envelope in a `CUSTOM` event named `a2ui`. `createRunReader` retains validated A2UI operations without maintaining a second UI state model. `validateA2uiMessages` enforces the product allowlist, message order, size/depth limits and acyclic component references. H5 uses CopilotKit’s `A2UIProvider` / `A2UIRenderer`; WeChat uses the same official `@a2ui/web_core` state processor with a small Taro host. Both consume the same catalog and operations, including data updates and surface deletion. Old replies with no artifacts compile to no surfaces.

Run `pnpm --filter @cfp/base-chat-protocol test` for upstream-schema conformance, malformed content, form validation and interrupted/chunked transport checks.

Renderer integration and compatibility limits: [ADR-0006](../../apps/a-j-oker/docs/adr/0006-copilotkit-a2ui-rendering.md).
