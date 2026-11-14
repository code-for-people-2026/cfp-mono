# `@cfp/agent-a2a`

Small A2A 1.0 JSON-RPC foundation built on `@a2a-js/sdk` 1.3.0. It supplies trusted card/peer registries, a framework-neutral `Request -> Response` server transport, durable send idempotency, scoped host adapters, and a bounded official-SDK client. It does not select or call a model.

## Deliberate limits

- JSON-RPC A2A 1.0 is the only accepted transport. A card may advertise optional non-JSON-RPC interfaces, but it must contain exactly one JSON-RPC interface and that interface must equal the configured endpoint URL.
- Base URLs are origins. Card and endpoint paths are separate, absolute trusted configuration. Redirects, URL credentials, queries, fragments, backslashes, control characters, dot segments, encoded separators, and non-HTTP(S) schemes are rejected. Plain HTTP is local-test-only.
- The outbound client does not automatically retry or replay sends. Each operation performs discovery and its intended RPC under one deadline so discovery, credential acquisition, injected fetch promises, response bodies, RPC promises, and stream iterator waits cannot keep the caller pending past the lifecycle budget. Deadline settlement aborts and closes transport resources where possible, but it does not claim that an injected fetch bridge or remote business operation honored cancellation; late settlements are observed and discarded.
- Push notification hosting and model execution are out of scope. Agent cards advertise push notifications as unsupported.
- Cancellation is supported only for a live executor that explicitly implements it. A recreated transport without the live event bus returns `TaskNotCancelable`; it never changes durable state and claims success. `createAgentExecutor` aborts the execution signal before invoking the host callback. That callback must stop the underlying work and publish a final canceled status before returning. Raw SDK executors must set `supportsCancellation: true` only when they provide the same semantics.

## Required host storage

`A2AHttpTransport` rejects missing storage at runtime. Production hosts must inject:

- `ScopedA2ATaskStore`, marked with `a2aScope: A2A_TASK_STORE_SCOPE`. Every `save`, `load`, `list`, and `hasContext` operation must partition by both `context.tenant` and `context.user.userName`. The latter is a composite JSON identity containing tenant, owner, and logical agent ID. A task or context ID alone must never be globally addressable.
- `A2ARequestLedger`, whose reservation key is the authenticated tenant/owner/agent scope plus `message.messageId`. `reserve` must be atomic, and `recordTask` must durably associate the first task snapshot before business execution starts.

An exact replay returns the stored task and never invokes the executor again. Reusing a message ID with different content is a conflict. If a reservation is still pending or failed without a recorded task, replay fails closed; the foundation does not retry execution or guess whether unknown effects occurred. Once the initial task and mapping are recorded, a recreated transport can recover the task from the same stores.

Client-chosen context IDs are accepted only when `hasContext` confirms ownership. Continuations and reference tasks are loaded through the same scoped store. Missing and foreign identifiers receive the same unavailable result so another owner's state is not disclosed.

## Discovery and authentication

Every configured agent requires at least one concrete A2A skill. Cards are encoded with the SDK's `AgentCard.toJSON` serializer, including the protobuf oneof security representation expected by the official client.

Authentication runs before any card, task, context, or executor access. The adapter must return non-empty host-established `owner` and `tenant` values. Authentication failures and outbound failures are sanitized; thrown peer/provider messages and credential values are not reflected.

## Checks

```sh
pnpm --filter @cfp/agent-a2a typecheck
pnpm --filter @cfp/agent-a2a lint
pnpm --filter @cfp/agent-a2a test
```

The unit tests retain an explicitly named in-memory `Request`/`Response` bridge. A separate integration test adapts the actual `A2AHttpTransport` to a Node HTTP socket and drives discovery, send/get/list, streaming, input follow-up, idempotent replay/conflict, cancellation, and owner/agent isolation through `A2APeerClient` and the official SDK wire implementation. Environments that reject `listen(2)` with `EPERM` skip only that socket test with an explicit reason; run it in the supervisor or a normal development environment.
