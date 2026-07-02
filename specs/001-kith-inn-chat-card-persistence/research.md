# Research: kith-inn Chat Card Persistence

## Current Completion Snapshot

The project has moved past skeleton status. Core Payload collections, seller scoping helpers, order lifecycle, delivery derivations, menu generation, manual payment state, agent tools, current-turn chat cards, and Today-page card rendering are already implemented with tests across `@cfp/kith-inn-be`, `@cfp/kith-inn-payload`, and `@cfp/kith-inn-shared`.

The remaining gap for this feature is narrow: the current turn can produce and render a card, but the persisted chat message only stores text. After reload, `GET /chat` cannot return cards because neither the CMS collection nor the backend projection carries them.

## Decision: Store the visible card snapshot on `chat_messages`

**Rationale**: The card is part of the visible assistant reply. Storing it with the assistant message preserves conversation history without re-running AI or tools.

**Alternatives considered**:

- Recompute cards from current orders/delivery on history load: rejected because it changes history and may trigger tool-like behavior.
- Store cards in a separate table: rejected because one assistant message has at most one visible card in the current product.
- Store raw tool calls and reconstruct cards: rejected because it persists internal traces and violates the display-history boundary.

## Decision: Use the existing `CardPayload` shape

**Rationale**: `cardPayloadSchema` already defines the visible card contract shared by backend and frontend. Reusing it avoids a parallel shape.

**Alternatives considered**:

- Create a looser untyped JSON contract: rejected because invalid historical cards should degrade safely.
- Version every card type now: deferred until there is evidence of card-shape migration pain.

## Decision: Keep `customer-confirm` action recovery out of this feature

**Rationale**: Current confirmation execution depends on in-process `pendingState`. Making「都建」reload-safe requires persisted action state and stale/completed transitions, which is a separate state-machine feature.

**Alternatives considered**:

- Include persisted confirmation state now: rejected because it expands the first Spec Kit trial beyond one shippable slice.
- Hide customer-confirm cards entirely in history: rejected because the user still loses important conversation context.

## Decision: Do not change retention or pagination

**Rationale**: Existing history load uses a latest-message limit. Card persistence does not require solving old-history pagination or GC.

**Alternatives considered**:

- Add cursor pagination now: rejected as a separate display-history feature.
- Rewrite retention policy now: rejected because it is unrelated to restoring card payloads.
