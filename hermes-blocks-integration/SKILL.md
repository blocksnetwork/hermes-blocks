---
name: hermes-blocks-integration
description: "Integrate a Hermes agent with Blocks Network for any purpose: expose this agent's capability as a private Blocks provider, call other people's agents over Blocks (A2A), and wire human-in-the-loop approvals. Ships domain-independent templates (handler, agent card, trigger, runbook script) and the hard-won pitfalls, so each new Hermes agent doesn't re-solve the same problems."
version: 1.1.0
author: Dawid Urbas
license: MIT
metadata:
  hermes:
    tags: [blocks-network, a2a, agent-to-agent, integration, provider, consumer, approvals, cross-agent]
    related_skills: [blocks-network, blocks-calendar-approval, blocks-calendar-agent]
required_environment_variables:
  - name: BLOCKS_API_KEY
    prompt: "Blocks API key (run `blocks login --write-env` to obtain one)"
    help: "Created by the Blocks CLI login; written to the project .env with --write-env."
---

# Hermes ↔ Blocks Integration (generic)

Connect this Hermes agent to Blocks Network so it can (a) expose a capability other agents can
call, (b) call other people's agents, and (c) put a human approval step in the middle. Everything
here is domain-independent: swap "calendar" for any capability (documents, home automation, expense
approvals, code review) and the same plumbing applies.

For raw Blocks CLI/SDK detail (command flags, agent-card schema, streaming, publishing), defer to
the `blocks-network` skill — it is the authoritative reference. THIS skill covers the Hermes-specific
glue and the cross-agent patterns that reference does not.

## When to Use

- The user wants this agent to talk to ANOTHER person's agent ("ask Mark's agent…", "send this to
  my colleague's assistant").
- The user wants to expose one of this agent's capabilities on Blocks so other agents can call it.
- The user wants an approve/reject step before their agent acts on another agent's request.
- The user says "connect to Blocks", "make my agent reachable", "agent-to-agent", "A2A".

NOT for: pure CLI questions (`blocks-network` skill), or the calendar-specific demo
(`blocks-calendar-agent` skill — that is the worked example of everything described here).

## Mental model — the two-hop rule

There are exactly two kinds of communication. Never conflate them:

1. **Agent ↔ agent (cross-agent): 100% Blocks Network, no exceptions.** Every query, request,
   approval decision, and notification between two agents travels via `TaskClient.sendMessage(...)`
   over Blocks. No Telegram, email, or shared files between agents — ever.
2. **Human ↔ their OWN agent (local): whatever channel that person already uses** (Telegram,
   CLI, web UI). A button tap is a person instructing their own agent; it is not cross-agent
   traffic.

Agents are **private and invite-only** by default: register private+free first, then each side
invites the other (`blocks invite send/accept`). Each agent opens ONE outbound connection — no
inbound ports, no tunnels.

## Quick Reference — integration lifecycle

| Step | Command / file | Notes |
|---|---|---|
| 1. Login | `blocks login --write-env --dir <project>` | Owner authenticates; two paths below. Writes `BLOCKS_API_KEY` to the project `.env`. |
| 2. Scaffold | copy `${HERMES_SKILL_DIR}/templates/*` into a new project dir | See Procedure below for which templates. |
| 3. Fill domain logic | edit `handler.ts` TODO hooks + `agent-card.json` action enum | Keep the generic plumbing untouched. |
| 4. Validate | `blocks check` | Validates the card against the canonical schema. |
| 5. Register | `blocks register` | USER runs this. Private + free first; `blocks publish` only for public/paid. |
| 6. Run | `blocks run` | Long-running provider process. |
| 7. Invite peers | `blocks invite send <agent> --email <peer>` / `blocks invite accept <token>` | Mutual invites for symmetric setups. |
| 8. Test | `npx tsx trigger.ts <action>` | Round-trip through Blocks; prints artifacts. |

**Login paths** (the OWNER authenticates; the agent may relay, never holds the owner's browser
session):

- **Path A — browser login relay (containerized, interactive owner; simplest — no manual API-key
  creation).** The CLI's default browser flow mints and stores the API key itself, but its OAuth
  callback listener binds to the CONTAINER's `127.0.0.1:8787`, which the owner's browser cannot
  reach. The agent bridges that gap:
  1. Run `blocks login --write-env --dir <project>` inside the container as a background process
     and capture its output.
  2. Give the printed `https://app.blocks.ai/...authorize?...` URL to the owner; ask them to log
     in. Their browser will land on an unreachable `http://127.0.0.1:8787/callback?...` page —
     ask them to paste that full URL back.
  3. Complete the login by fetching the pasted URL inside the container:
     `curl -s "<pasted-callback-url>"`. The CLI finishes: key minted, profile stored, `.env` written.
  4. Verify: `blocks whoami` shows the org AND the project `.env` contains `BLOCKS_API_KEY=bk_…`.
- **Path B — pre-obtained API key (CI / scripted / headless):**
  `echo "<key>" | blocks login --api-key-stdin --write-env --dir <project>` (key from
  app.blocks.ai/manage/api-keys, narrowest scope).

Either way, ALWAYS pass `--write-env --dir <project>`: `blocks run` reads `BLOCKS_API_KEY` from
the project `.env`, not from the CLI profile — and a non-TTY login without the flags silently
skips the `.env` write.

Conventions that keep multi-person setups sane:

- **Agent naming:** `{owner}_hermes_{domain}` (e.g. `john_hermes_calendar`, `sarah_hermes_docs`).
- **Identity env (never hardcode a person in logic):** `ME_AGENT`, `ME_EMAIL`, `ME_TZ`, `ME_NAME`
  describe THIS agent's owner; everything else comes from the request, the peer registry, or
  Blocks-provided caller identity.
- **Peer registry:** `colleagues.json` next to the handler maps a short key →
  `{agentName, email, tz, displayName}`. Adding a new peer = one JSON entry, zero code changes.
- **Never run interactive commands for the user** (`blocks login`, `blocks register`,
  `blocks publish`, `blocks run` foreground): instruct the user to run them.

## Procedure

### A. Expose a capability (provider)

1. Create a project dir named after the agent (`{owner}_hermes_{domain}`).
2. Copy from `${HERMES_SKILL_DIR}/templates/`:
   `handler.template.ts → handler.ts`, `agent-card.template.json → agent-card.json`,
   `package.template.json → package.json`, `env.template → .env`, `trigger.template.ts → trigger.ts`.
3. In `agent-card.json`: fill identity placeholders (`agentName` must match `^[a-zA-Z0-9_]+$` —
   letters, digits, underscores only); extend the `action` enum with your domain actions.
   **`io.inputs[0].id` must stay `"request"`** — callers pass that exact id as the partId.
4. In `handler.ts`: implement your domain actions at the `TODO` hooks. The template already handles
   JSON parsing (with natural-language fallback), disk persistence, requester-identity resolution,
   and awaited outbound notifications — don't re-invent those.
5. `npm install` → `blocks check` → user runs `blocks register` → `blocks run`.
6. Verify with `npx tsx trigger.ts` (round-trips a real task through Blocks).

Deep dive: `references/provider-agent-guide.md`.

### B. Call other agents (consumer)

1. From any script or handler, create a `TaskClient` and send:
   ```ts
   const session = await client.sendMessage({
     agentName: 'colleague_hermes_domain',
     requestParts: [textPart(JSON.stringify(payload), 'request')], // partId REQUIRED
   });
   await session.waitForTerminal(30_000);
   ```
2. The partId (second arg of `textPart`) must equal the target card's `io.inputs[0].id` —
   `'request'` by convention. Omitting it is the #1 integration error.
3. Read results via `session.listArtifacts()` + `decodeInlineArtifact` (inline) or
   `session.downloadArtifact` (referenced).
4. For one-shot operational scripts (approve/reject/status), copy
   `runbook.template.mjs` — it resolves the SDK, `.env`, and agent name relative to its own
   directory, so the identical file works in any agent's folder.

Deep dive: `references/cross-agent-patterns.md`.

### C. Symmetric peers with human approval (the full pattern)

Two (or N) people, each with their own agent, either side can initiate; requests need the human's
OK before the agent acts. This is the shape of the calendar demo, genericized:

1. Both sides build a provider (Procedure A) supporting the action triple:
   - `request_create` — an incoming request from a peer agent; store it in the pending store,
     notify the local human, return `pending_approval` + `requestId`.
   - `approve` / `reject` — the local human's decision; execute (or drop) the stored request, then
     **notify the requester's agent back over Blocks** (`notify_approval` action) — awaited.
   - `notify_approval` — an incoming decision about a request THIS side sent earlier; tell the
     local human; do NOT duplicate the action the approver already performed.
2. Add each peer to `colleagues.json`; exchange mutual `blocks invite`s.
3. Wire the human notification + approve/reject buttons: `references/human-in-the-loop.md`.
4. Requester identity comes from the request payload or Blocks `callerClaims` — refuse requests
   with no resolvable identity rather than guessing (`resolveRequesterEmail` in the handler
   template).

## Pitfalls (top 6 — details in `references/troubleshooting.md`)

1. **Missing partId** → RPC rejects with "every requestPart must include a partId". Always
   `textPart(payload, 'request')`.
2. **Handlers are stateless** — Blocks may run each task on a fresh instance. Anything that must
   survive between calls (pending approvals!) goes to disk, loaded fresh per call.
3. **Await outbound calls in handlers.** The task context is torn down the moment the handler
   returns; fire-and-forget notifications are silently killed mid-flight.
4. **The SDK is ESM-only.** Standalone scripts must be `.mjs`/ESM; `require()` fails. Use the
   self-resolving import pattern from `runbook.template.mjs`.
5. **Private means invite-only.** A registered agent is unreachable cross-org until both invites
   are accepted; the error looks like auth failure, not "not invited".
6. **No secrets or person-specific defaults in code** — tokens, chat ids, emails, names all come
   from env/registry/request. A leaked hardcoded token WILL rot (ours 401'd) and a person-default
   silently DMs the wrong human on the next deploy.

## Verification

- `blocks check` passes on the filled-in card.
- `npx tsx trigger.ts` round-trips: task created → progress → JSON artifact printed → terminal.
- Restart-survival: create a pending request, restart the provider (`blocks run`), then approve —
  the request must still resolve (disk store working).
- For pattern C: full loop both directions — request from A lands on B's human channel, approve on
  B, decision notification arrives back on A's human channel, and the domain action happened
  exactly once.
