# Cross-agent (A2A) patterns

The recipes for agents talking to agents over Blocks. All cross-agent traffic uses these; there is
no other channel between agents (two-hop rule — see SKILL.md).

## 1. Calling another agent from a script or handler

```ts
import { TaskClient, textPart } from '@blocks-network/sdk';

const client = await TaskClient.create({ billingMode: 'free', apiKey: process.env.BLOCKS_API_KEY });
try {
  const session = await client.sendMessage({
    agentName: targetAgent,                                    // e.g. 'mark_hermes_calendar'
    requestParts: [textPart(JSON.stringify(payload), 'request')], // partId = target's io.inputs[0].id
  });
  await session.waitForTerminal(30_000);
  // optionally read session.listArtifacts() for the response
  session.close();
} finally {
  client.destroy();
}
```

Rules:
- **partId is mandatory** and must equal the target card's input id (`'request'` by convention).
  `textPart(text)` alone defaults the partId to `"text"` and the RPC rejects it.
- Always `waitForTerminal` with a timeout, `close()` the session, `destroy()` the client — leaked
  clients keep the process alive.

## 2. Calling out from INSIDE a handler — the await rule

A provider handler is request/response: the moment it returns, the task context is torn down and
any in-flight async work is killed. A fire-and-forget notification therefore dies silently — the
symptom is "the other side never got notified" with zero errors logged.

```ts
// WRONG — killed at handler return, no error anywhere:
notifyRequesterAgent(peer, payload);
return { artifacts: [...] };

// RIGHT — awaited before returning:
await notifyRequesterAgent(peer, payload);
return { artifacts: [...] };
```

`notifyRequesterAgent` (in the handler template) wraps pattern #1 with its own try/catch so a dead
peer can't fail the main task, and no-ops when `BLOCKS_API_KEY` or the target is missing. Budget
its `waitForTerminal` timeout inside your card's `maxRunningTimeSec`.

## 3. The request → approve → notify-back round trip

The generic action triple for "agent B may not act on agent A's request without B's human saying
yes" — either side can play either role:

```
A's human          A's agent (Blocks)            B's agent (Blocks)          B's human
    |  "ask B for X"     |                             |                        |
    |------------------->|  request_create {…,         |                        |
    |                    |    requesterAgent: A}       |                        |
    |                    |---------------------------->| store pending,         |
    |                    |   ← pending_approval,reqId  | notify human --------->|
    |                    |                             |                        |
    |                    |                             |   approve reqId        |
    |                    |                             |<-----------------------|
    |                    |                             | perform the action,    |
    |                    |  notify_approval {decision} | delete pending         |
    |                    |<----------------------------|  (awaited!)            |
    |  "B approved ✅"    |                             |                        |
    |<-------------------|                             |                        |
```

Contract details that matter:
- The requester includes `requesterAgent: ME_AGENT` in `request_create` — that's the return
  address. The approver persists it with the pending request.
- Both `approve` AND `reject` notify back (`decision: 'approved' | 'rejected'`). A requester left
  hanging on rejection is a bug.
- `notify_approval` on the requester side is **notify-only**: tell the local human, do NOT repeat
  the domain action. The approver already performed it exactly once; doing it again double-books
  (in the calendar case: ONE shared event with the requester as invitee, never two copies).
- `requestId`s (`req_<unique>`) travel in every message so humans can reference them in button
  labels and natural language.

## 4. Identity resolution — no hardcoded people

Never keep name→email (or name→anything) maps in logic. Resolve who you're dealing with, in order:

1. **Explicit request fields** (e.g. `attendees` containing real emails) — validate with an email
   regex; a display name is not an identity.
2. **Blocks-provided caller identity** — `task.callerClaims.email`, `task.callerClaims.sub`,
   `task.ownerId`.
3. **Refuse.** Return an error artifact telling the caller exactly what to include. Guessing books
   meetings with the wrong person; refusing produces a self-correcting error message.

`resolveRequesterEmail` in the handler template implements this order and logs which source won.

## 5. Peer registry (`colleagues.json`)

The initiating side needs to know who "Mark" is. That mapping is DATA, not code:

```json
{
  "mark": { "agentName": "mark_hermes_calendar", "email": "mark@example.com",
             "tz": "America/Los_Angeles", "displayName": "Mark" }
}
```

Scripts take `--with <key>` and look the peer up; the owner's own identity comes from `ME_*` env.
Result: the SAME script runs unchanged on any agent, any direction, and onboarding a new colleague
is one JSON entry + mutual `blocks invite` — zero code.

## 6. Person-independent runbook scripts

Operational one-shots (approve, reject, list pending) should work identically in every agent's
folder. The trick (see `../templates/runbook.template.mjs`): resolve everything relative to the
script's own location —

```js
const __dir = path.dirname(fileURLToPath(import.meta.url));
const AGENT_NAME = process.env.LOCAL_AGENT_NAME || process.env.ME_AGENT || path.basename(__dir);
// SDK + dotenv imported via pathToFileURL(path.join(__dir, 'node_modules/...')) — works from any cwd
loadEnv({ path: path.join(__dir, '.env') });
```

This kills three recurring failures at once: wrong-cwd module resolution (cron!), CommonJS
`require` of the ESM-only SDK, and copy-paste identity drift between agents. Pair the script with
a tiny runbook skill (like `blocks-calendar-approval`) that just says "find and run this script,
report the result in one line" — the agent's LLM should execute runbooks, not improvise SDK calls.
