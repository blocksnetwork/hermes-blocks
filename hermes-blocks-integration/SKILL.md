---
name: hermes-blocks-integration
description: "Connect any Hermes agent to Blocks Network as a provider, consumer, or composed agent. Use when exposing an existing Hermes capability through Blocks, calling another Blocks agent from Hermes, scaffolding or validating an agent card and handler, or debugging Hermes-to-Blocks transport. Includes a deterministic generic scaffold and optional references for advanced workflows such as human approval."
---

# Hermes ↔ Blocks integration

Use Blocks as the agent-to-agent boundary around an existing Hermes capability. Keep the core
integration domain-neutral: a provider receives a structured request, invokes capability logic,
and returns an artifact; a consumer sends a structured request and reads the artifact.

Load the `blocks-network` skill, sourced from `https://config.blocks.ai/SKILL.md`, whenever exact
CLI flags, SDK behavior, agent-card schema, invitations, publishing, or streaming matters. That
reference is authoritative for Blocks. This skill adds the Hermes-specific workflow and safe
project scaffold. Fetch it only from the official origin and review upstream changes before
adopting them.

## Architecture

Keep this integration as a skill. Hermes can operate the Blocks CLI and SDK through the terminal,
so a built-in Hermes tool is unnecessary unless a future requirement cannot be expressed through
those interfaces.

The core supports three roles:

1. **Provider** — expose a Hermes capability as a Blocks agent.
2. **Consumer** — call a Blocks agent from Hermes or a deterministic script.
3. **Composed agent** — call another Blocks agent from inside a provider handler and await it.

Do not bake business workflows into the transport layer. Persistence, delayed decisions,
notification UIs, or any domain behavior belong in adapters layered on top.

## Non-negotiable protocol rules

- Use Node 22+ with the current `@blocks-network/sdk` and `@blocks-network/cli` versions declared
  by the scaffold.
- Pass a `partId` on every input. With the scaffolded card, call
  `textPart(JSON.stringify(payload), 'request')`.
- Make the part id equal the target card's `io.inputs[0].id`; inspect the target card instead of
  assuming when calling an agent you do not own.
- Await `waitForTerminal(...)` and every nested outbound call before a handler returns.
- Read result artifacts with `listArtifacts()`, `decodeInlineArtifact`, or `downloadArtifact`.
- Return a JSON artifact on both success and failure so callers receive a useful diagnostic.
- Keep SDK scripts ESM (`.mjs`, or TypeScript in a `"type": "module"` project).
- Read credentials from the project environment. Never place keys or person-specific identity
  defaults in source or templates; agent identity supplied to the scaffold is configuration.

## Scaffold a provider

Collect a project directory, valid Blocks agent name, and one-sentence description, then run the
bundled [scaffold script](scripts/scaffold.mjs):

```bash
node "${HERMES_SKILL_DIR}/scripts/scaffold.mjs" \
  --project-dir <project-dir> \
  --agent-name <agent_name> \
  --description "<capability description>"
```

Optional flags: `--display-name`, `--organization`, and `--dry-run`.

The script renders the bundled [agent card](templates/agent-card.template.json),
[handler](templates/handler.template.ts), [client](templates/call.template.mjs),
[package](templates/package.template.json), [TypeScript config](templates/tsconfig.template.json),
[environment](templates/env.template), and [gitignore](templates/gitignore.template) templates.

The scaffold creates:

- `agent-card.json` — a valid request/response card with a safe `health` action.
- `handler.ts` — a minimal Hermes capability adapter with JSON artifacts.
- `call.mjs` — a deterministic consumer and smoke-test command.
- `package.json`, `tsconfig.json`, and `.env` — current dependencies, strict type checking, and
  project-local configuration.
- `.gitignore` — excludes credentials, dependencies, logs, and platform metadata.

It refuses to overwrite any existing file. For an existing integration, compare and merge; never
replace its handler, card, or `.env` wholesale.

## Implement the provider

1. Add each capability action to the card's `action` enum.
2. Add the matching handler cases. Keep Blocks parsing and artifact construction separate from
   domain functions so the capability remains testable outside Blocks.
3. Add only the domain credentials the handler actually needs to `.env`; never commit that file.
4. Install and validate:

   ```bash
   npm install
   npm run typecheck
   npm run check
   ```

5. Have the owner authenticate and run the Blocks lifecycle:

   ```bash
   blocks login --write-env --dir <project-dir>
   blocks register
   blocks run
   ```

Register private/free first. Publishing or paid configuration is a separate, deliberate action.
Interactive authentication, registration, publishing, and the long-running provider process stay
under user control.

Read `references/provider-agent-guide.md` when changing the handler/card contract or operating a
containerized provider.

## Call an agent

Use the generated deterministic client:

```bash
npm run call -- <target_agent> '{"action":"health"}'
```

Or use the SDK directly:

```ts
const session = await client.sendMessage({
  agentName: targetAgent,
  requestParts: [textPart(JSON.stringify(payload), targetInputId)],
});
await session.waitForTerminal(130_000);
```

Always close the session and destroy the client. For private cross-organization agents, complete
the required Blocks invitation flow first.

Read `references/cross-agent-patterns.md` for artifact decoding, nested calls, timeouts, and an
optional peer-alias registry.

## Optional workflow adapters

Only load `references/human-in-the-loop.md` when the requested capability requires delayed human
approval. It documents a channel-neutral state machine and the implementation shape validated by
provider integrations. Its persistence, credentials, notification UI, and action names are
domain-specific choices—not requirements of the core Hermes ↔ Blocks integration.

## Troubleshoot and verify

Read `references/troubleshooting.md` by symptom. Before handing off an integration, verify:

1. `npm run typecheck` passes.
2. `npm run check` passes.
3. `npm run call -- <agent> '{"action":"health"}'` returns a JSON artifact.
4. Every declared domain action succeeds and returns an artifact.
5. Invalid input also returns a diagnostic artifact rather than an opaque task failure.
6. Nested calls, if any, are awaited and fit within `runtime.maxRunningTimeSec`.
7. Capability-specific tests cover payload limits, authorization, sensitive inputs, and failures.
