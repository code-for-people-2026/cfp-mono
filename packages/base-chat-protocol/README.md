# base-chat-protocol

Shared, browser-safe reply and presentation protocol used by the a-j-oker backend and Taro clients. Owns validated response artifacts, A2UI v0.9.1 catalog/envelopes and bounded message validation, user actions and AG-UI SSE framing. AG-UI event framing and A2UI presentation both belong here. It has no model, storage, identity or server dependencies. Product API contracts, age verification, consent and complaints belong to `@cfp/a-j-oker-contracts`; this package must not depend on that business package.

The protocol defines a product-neutral default catalog identifier and the bounded `Column`, `Card`, `Text`, `Image`, `Table`, `Code`, `Page`, `FormField` and `Button` component shapes. Product packages own their published catalog identifiers, compatibility catalogs, discovery routes, surface naming and private resource URLs. Form values use `/values/<fieldId>`; only explicit `submit_form` actions transmit them. Child references use the standard A2UI `ComponentId` / `ChildList` definitions.

Hosts compile a versioned presentation with `presentationToA2ui` or bounded legacy artifacts with `legacyArtifactsToA2ui`, supplying catalog, surface and resource adapters. AG-UI carries each envelope in a `CUSTOM` event named `a2ui`. `createRunReader` retains validated A2UI operations without maintaining a second UI state model. `validateA2uiMessages` enforces the allowlist, message order, size/depth limits and acyclic component references. UI platform hosts live in `@cfp/chat-ui-taro`; this protocol package has no renderer or DOM dependency.

Run `pnpm --filter @cfp/base-chat-protocol test` for upstream-schema conformance, malformed content, form validation and interrupted/chunked transport checks.

Renderer integration and compatibility limits: [ADR-0006](../../apps/a-j-oker/docs/adr/0006-copilotkit-a2ui-rendering.md).
