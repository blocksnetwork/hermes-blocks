# Human-in-the-loop approvals

How the local human sees a pending cross-agent request and answers it. This is hop 2 of the
two-hop rule — human ↔ their OWN agent, over whatever channel that person already uses. Nothing
here is cross-agent traffic.

## The persistence prerequisite (non-negotiable)

Whatever UX you pick, the pending request must be on disk before the human is notified. The
handler that stored it terminates immediately; the approval arrives minutes later, possibly on a
fresh handler instance, possibly via a different process entirely. The template's store:

- Path: `PENDING_STORE_PATH` env, else `${DATA_DIR}/pending_approvals.json`.
- Load fresh from disk at the start of every handler call; write on every mutation.
- Shape: `{ "<requestId>": { id, action, summary, ..., requesterAgent, requestedAt } }`.

"Request not found or already processed" on a request you can see in the human's chat = the store
path differs between writer and reader (typically host vs container path).

## Approval UX options, ranked

### Option 1 — reply-keyboard buttons whose label IS the command (recommended; what we shipped)

Send the notification through the messaging bot the Hermes gateway already owns, with a reply
keyboard where each button's visible label is a parseable command:

```json
{ "keyboard": [["✅ approve req_abc123", "❌ reject req_abc123"]],
  "one_time_keyboard": true, "resize_keyboard": true }
```

Tapping a button makes the human's client SEND that text as a normal message → the gateway routes
it to the agent like any other message → the handler's natural-language matcher picks it up. No
second process, no callback plumbing, works with the existing gateway. Cost: the tap is visible as
a sent message (fine — it's an audit trail).

The handler-side matcher must be emoji-tolerant and extract the id:

```ts
const trimmed = rawText.trim().toLowerCase();
const reqIdMatch = trimmed.match(/req_[a-z0-9_-]+/);
const parsedReqId = reqIdMatch ? reqIdMatch[0] : null;
const isApprove = /(^|\s)(✅|approve|yes|sure|accept|ok)(\s|$)/.test(trimmed) && !/reject|deny|decline|❌/.test(trimmed);
const isReject  = /(^|\s)(❌|reject|no|deny|decline)(\s|$)/.test(trimmed) && !/approve|✅/.test(trimmed);
```

Fall back to "most recent pending" when no id parses (bare "yes"/"no").

### Option 2 — Hermes-native clarify buttons

Where the flow is driven by a Hermes conversation (not a push notification), use Hermes's own
inline-button facility (`clarify`) and let Hermes translate the choice into the runbook script.
Zero custom transport code; only fires when Hermes is already mid-conversation with the user.

### Option 3 — standalone callback bridge (last resort)

A long-lived process long-polling a bot's `getUpdates`, turning `callback_data` taps into a Blocks
call on the person's OWN agent. Only needed when you must push real inline buttons outside any
gateway conversation. Two sharp edges: (a) one bot = one consumer — `getUpdates` conflicts with a
gateway or webhook already owning the bot (HTTP 409), so it needs a DEDICATED bot token; (b) it's
another process to supervise. Prefer options 1–2.

## Notifying the human (send side)

- Read bot tokens and chat ids from env ONLY (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). No
  defaults: a missing chat id must skip-and-log, not DM some hardcoded person's chat. Hardcoded
  tokens rot — a revoked token returns 401 forever and the notification path dies silently.
- **Await the send** when it happens inside a handler (task-teardown rule).
- Include in the message: what's being asked, by whom (resolved identity), the times/payload in
  the human's own timezone, and the `req_` id.

## Closing the loop

On approve/reject the handler must, in order: perform (or drop) the stored action exactly once →
delete from the pending store → **notify the requester's agent over Blocks** (`notify_approval`,
awaited) → return a one-line result the human channel can show. The requester side's
`notify_approval` case then tells ITS human — and does not repeat the action.
