# Optional pattern: delayed human approval

This is an adapter pattern, not part of the base Hermes ↔ Blocks transport. Load it only when a
capability must pause for a person's decision after the incoming Blocks task has ended.

## State machine

Use domain-appropriate action names, but preserve these transitions:

1. A peer submits a request.
2. The provider validates it and persists a pending record before notifying its local human.
3. The provider returns a `pending` result with a stable request id.
4. The local human later approves or rejects through the channel already owned by Hermes.
5. The provider atomically claims the pending record, performs the action at most once when
   approved, persists the terminal decision, and optionally notifies the requesting Blocks agent.

The approval channel is local human ↔ Hermes. Cross-agent communication remains Blocks.

## Persistence requirements

- Store pending and terminal decisions outside process memory.
- Resolve the store path relative to the provider or an explicit environment setting.
- Load state fresh for every invocation; the decision may run in a different process.
- Use atomic writes or a transactional store.
- Preserve idempotency so retries cannot perform the approved action twice.
- Expire pending requests, rate-limit creation per requester, and reject replayed terminal ids.
- Record requester/return-agent identity from validated input or Blocks caller claims; never guess.

Example record:

```json
{
  "id": "req_abc123",
  "operation": "domain_action",
  "payload": {},
  "requesterAgent": "calling_agent",
  "status": "pending",
  "createdAt": "2026-01-01T12:00:00Z"
}
```

## Notification boundary

Use the human channel Hermes already owns. Do not introduce a second consumer for the same bot,
queue, or webhook. Keep credentials in the environment and await sends performed inside a Blocks
handler.

If the requester needs a later decision notification, send it over Blocks and await it before the
decision handler returns. The receiving side should notify its human; it must not repeat the action
already performed by the approving provider.

## Validated implementation shape

This pattern has been validated in provider integrations using file-backed pending state,
idempotent approve/reject actions, and awaited notify-back. The external service actions,
credentials, requester fields, notification UI, and action names were implementation-specific.
Carry forward only the state-machine and transport invariants required by the new domain.
