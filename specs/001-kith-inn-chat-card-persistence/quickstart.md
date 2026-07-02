# Quickstart: Validate kith-inn Chat Card Persistence

## Automated Checks

Run the narrow checks for this feature:

```bash
pnpm --filter @cfp/kith-inn-shared test
pnpm --filter @cfp/kith-inn-payload test
pnpm --filter @cfp/kith-inn-be test
pnpm --filter @cfp/kith-inn-fe test
```

Expected outcomes:

- Shared schema tests cover chat messages with and without valid cards.
- Payload tests still pass after adding the nullable card field.
- Backend chat tests prove `POST /chat` persists assistant cards and `GET /chat` returns safe card payloads.
- Frontend tests or component-level coverage prove restored history messages can render cards and do not crash on missing cards.

## Manual Smoke

1. Log in to kith-inn.
2. Ask a Today-page question that returns an orders or delivery card.
3. Close/reopen or reload the Today page.
4. Confirm the previous assistant text and card both appear in the same conversation position.
5. Confirm no new message was sent and no AI response was regenerated.

## Non-Goals To Check

- Do not add chat pagination or retention GC in this feature.
- Do not add persisted `customer-confirm` action state in this feature.
- Do not expose raw tool calls, system prompts, or LLM traces in history.
