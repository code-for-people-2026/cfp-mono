# Data Model: kith-inn Chat Card Persistence

## Entity: Chat Message

Existing visible conversation message for a seller/operator.

### Existing fields

- `id`
- `operator`
- `content`
- `role`
- `createdAt`
- `seller`

### New field

- `card`: optional nullable JSON value containing one visible assistant card snapshot.

### Validation Rules

- `card` is only meaningful for `role = assistant`.
- If present, `card` must match the shared `CardPayload` contract.
- Invalid historical `card` data must be omitted from the client response rather than crashing history load.
- User messages must not receive generated cards.

### State Notes

- `card` is a historical snapshot, not a live view.
- No `cardStatus` or action-state field is added in this feature.
- New-customer confirmation action recovery will need a later data-model change.

## Migration Notes

- Add a nullable JSON/JSONB column to `cms.chat_messages`.
- Existing rows remain valid with `card = null`.
- No backfill is required.
- No retention or pagination schema change is part of this feature.
