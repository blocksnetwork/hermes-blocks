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
├── tsconfig.json    # strict no-emit TypeScript validation
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

From the provider project, local validation is:

```bash
npm install
npm run typecheck
blocks check
```

The user owns authentication and every account/runtime decision. After the user authenticates and
explicitly approves each step, Hermes may register private/free, start the runner, and send the
health request. Publishing remains a separate owner action because it changes listing or billing
and may require accepting terms. Use Blocks invitations for private cross-organization access.

The runner reads `BLOCKS_API_KEY` from the project environment. A successful `blocks whoami`
does not prove the provider project has the key.

## Containers

- Add `$HOME/.blocks/bin` to `PATH` before using the CLI installed by the project. Do not assume
  `npx blocks` resolves the project-installed binary.
- Use paths visible to the running process, not host-only paths.
- Keep `.env` and any capability state on a persistent mount.
- Set `HERMES_CONTAINER_NAME` to the host-side Docker name when creating the Hermes container. The
  skill can then build a resolved `docker exec` login command without asking the user for metadata
  already chosen during setup.
- Default to API-key login because a browser callback inside the container may be unreachable.
  Direct the user to `https://app.blocks.ai/manage/api-keys`, then give them one host-side command
  that reads the key silently and pipes it to `blocks login --api-key-stdin --write-env --dir .`
  inside the container. Never request the key in chat or embed it in shell history.
- A host terminal cannot `cd` to `/opt/data/...`. Use `docker exec` with the container name from
  `HERMES_CONTAINER_NAME` or the user, `--env HOME=/opt/data/home`, `--user hermes`, and
  `-w <project-dir>`.
- Supervise `blocks run` as a service and preserve its logs.
