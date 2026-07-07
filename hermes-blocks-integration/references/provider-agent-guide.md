# Provider agent anatomy

What a working Blocks provider project looks like and which parts matter. Template files in
`../templates/` implement all of this; this doc explains WHY each piece is shaped that way.

## Project layout

```
{owner}_hermes_{domain}/
├── agent-card.json      # identity + IO contract; validated by `blocks check`
├── handler.ts           # the capability; default-exported async function
├── trigger.ts           # consumer test script (round-trip smoke test)
├── runbook.mjs          # one-shot operational script (approve/reject/status)
├── colleagues.json      # peer registry (only for cross-agent setups)
├── package.json         # "type": "module"; @blocks-network/sdk + dotenv
├── .env                 # BLOCKS_API_KEY, ME_* identity, domain-specific keys
└── pending_approvals.json  # runtime state (created by the handler)
```

## Agent card — the fields that actually bite

Canonical schema: https://config.blocks.ai/references/agent-card.schema.json (validate with
`blocks check`; the `blocks-network` skill documents every field). The load-bearing parts:

- **`io.inputs[0].id`** — this string IS the partId every caller must pass as the second argument
  of `textPart(...)`. Convention: `"request"`. If a caller omits it or uses a different id, the RPC
  rejects the task before your handler ever runs. Changing this id breaks every existing caller.
- **`io.inputs[0].schema`** — an object schema with a required `action` string enum. The
  single-input/action-enum design keeps one handler per agent and makes new capabilities additive:
  add an enum value + a `case`, callers of old actions are unaffected.
- **`io.outputs[0]`** — `{ id: "result", contentType: "application/json", guaranteed: true }`.
  Guaranteed means every task returns at least this artifact — your handler must return an
  artifact even on errors (see handler contract).
- **`capabilities.taskKinds: ["request"]`** — request/response. Streaming (`pipe`) is a different
  contract; see the `blocks-network` skill.
- **`runtime`** — `handler` path, `handlerExport: "default"`, `concurrency`, `maxRunningTimeSec`
  (keep ≥ the longest downstream call your handler awaits, including cross-agent notifications
  which can take up to their own `waitForTerminal` timeout).

## Handler contract

```ts
export default async function handler(
  task: StartTaskMessage,
  ctx?: TaskContext,
): Promise<HandlerResult>
```

1. **Parse defensively.** `task.requestParts?.[0]?.text` is the raw input. Try `JSON.parse`; on
   failure treat the whole text as `{ action: rawText.trim() }` — humans and LLMs will send plain
   words ("approve", "yes") and that fallback is what makes button-labels-as-commands work.
2. **Report progress** with `ctx?.reportStatus('...')` for anything slower than ~a second — the
   caller sees these as progress events.
3. **Always return an artifact**, success or error:
   ```ts
   return { artifacts: [{ data: JSON.stringify(result, null, 2), mimeType: 'application/json' }] };
   ```
   Wrap the whole body in try/catch and return the error as a JSON artifact — an unhandled throw
   gives the caller an opaque failure instead of your diagnostic.
4. **Statelessness.** Blocks may run every task on a fresh instance. Module-level `Map`s survive
   only by luck. The template persists to a JSON file (`PENDING_STORE_PATH` or
   `DATA_DIR/pending_approvals.json`), loading fresh from disk at the start of every call and
   writing on every mutation. This also makes state visible to sibling processes (runbook scripts,
   bridges).
5. **Caller identity.** `task.callerClaims` (email/sub) and `task.ownerId` are Blocks-provided.
   Prefer explicit fields in the request payload, fall back to claims, and refuse when neither
   yields a usable identity — never keep a name→person map in code (see
   `cross-agent-patterns.md`).
6. **Outbound calls from inside a handler must be awaited** before returning — task teardown
   kills in-flight work. See `cross-agent-patterns.md` for the full pattern.

## The action-enum dispatch pattern

One `switch (action)` with three families of cases:

- **Domain actions** (yours): `list`, `create`, whatever the capability does.
- **Approval actions** (generic, from the template): `request_create`, `approve`, `reject`,
  `get_approval`/`pending`, `notify_approval`.
- **Default**: natural-language fallback — match approve/reject words against pending requests,
  else return a help artifact listing valid actions with JSON examples. A good help response is
  what lets ANOTHER agent's LLM figure out your API from one failed call.

## Registration lifecycle

`blocks login --write-env --dir <project>` (browser relay for interactive owners, `--api-key-stdin`
for headless — see SKILL.md Login paths and troubleshooting.md for the container-callback relay) →
`blocks check` → `blocks register` (private + free — the default posture; publishing public/paid
is a separate, deliberate step) → `blocks run` (long-running; supervise it like any service) →
mutual `blocks invite` for each peer org. All interactive commands are run by the USER, not by
Hermes. Credentials land in `~/.config/blocks/credentials.json`; inside a container, remember the
project dir is typically mounted (e.g. host `./agent-dir` = container `/opt/data/agent-dir`) — use
container paths in configs that run inside, host paths in docs for humans.
