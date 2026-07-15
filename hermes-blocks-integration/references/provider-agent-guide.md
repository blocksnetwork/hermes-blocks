# Provider agent guide

Read this reference when changing the generated provider contract, deploying it in a container, or
operating the Blocks lifecycle.

## Project layout

```text
blocks-provider/
├── agent-card.json  # Blocks identity and request/response contract
├── handler.ts       # Hermes capability adapter
├── call.mjs         # deterministic consumer and smoke test
├── package.json     # ESM project with Blocks SDK/CLI
├── .env             # project-local credentials; never commit
└── .gitignore       # excludes secrets, dependencies, logs, and platform metadata
```

Add domain modules beside the handler. Add state only when the capability requires it; persistence
is not part of the base transport.

## Agent card

Validate the card with `blocks check`. Treat the canonical schema from the `blocks-network` skill
as authoritative. The load-bearing fields are:

- `identity.agentName`: letters, digits, and underscores.
- `io.inputs[0].id`: the exact `partId` every caller must send. The scaffold uses `request`.
- `io.inputs[0].schema`: the public input contract. Add an enum value for every implemented action.
- `io.outputs[0]`: a guaranteed JSON result artifact.
- `runtime.handler` and `handlerExport`: the executable handler contract.
- `runtime.maxRunningTimeSec`: must cover domain work plus all awaited downstream calls.

Pin the provider handler to its card's input id. Configure a different target input id only in
consumer code. Return `outputId: "result"` with the scaffolded guaranteed artifact.

Changing an input id or action contract breaks existing callers. Version public contracts
deliberately.

## Handler boundary

Keep the handler thin:

1. Find the declared input part and read its text.
2. Enforce JSON and payload limits, then dispatch the action.
3. Call capability functions that do not depend on Blocks when practical.
4. Report progress for slow work with `ctx?.reportStatus(...)`.
5. Return a JSON artifact for success and failure.

Never let a normal validation or domain error escape as an opaque task failure. Sanitize public
errors and never log secrets, URLs containing credentials, or entire sensitive payloads.

If a handler calls another Blocks agent, await that task before returning, close its session, and
destroy its client. See `cross-agent-patterns.md`.

## Lifecycle

From the provider project:

```bash
npm install
npm run check
blocks login --write-env --dir .
blocks register
blocks run
```

The user owns authentication, registration, publishing, and the long-running process. Register
private/free first. Use Blocks invitations for private cross-organization access.

`blocks run` reads `BLOCKS_API_KEY` from the project environment. A successful `blocks whoami`
does not prove the provider project has the key.

## Containers

- Use paths visible to the running process, not host-only paths.
- Keep `.env` and any capability state on a persistent mount.
- If browser login runs inside a container, the OAuth callback may bind to container localhost.
  Follow the current login relay/headless procedure in the `blocks-network` skill rather than
  encoding a machine-specific callback workaround here.
- Supervise `blocks run` as a service and preserve its logs.
