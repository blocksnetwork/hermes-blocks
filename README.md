# Hermes Blocks Integration

Create, call, compose, and troubleshoot [Blocks Network](https://blocks.ai) agents from
[Hermes Agent](https://github.com/NousResearch/hermes-agent). The integration is a Hermes skill:
Hermes uses the bundled scaffold and the Blocks CLI/SDK, while business logic stays in the
provider project it creates.

## Install

Run this in the environment where Hermes stores its skills:

```bash
hermes skills install \
  blocksnetwork/hermes-blocks/hermes-blocks-integration \
  --yes
```

Restart the Hermes gateway after installation, then invoke `/hermes_blocks_integration` in your
connected chat.

## Telegram workflow

Hermes guides provider creation as a short conversation:

1. Choose whether to create a provider, call an agent, compose agents, or troubleshoot.
2. Describe the capability and give it a display name.
3. Review the generated agent name, description, and project path.
4. Confirm before Hermes writes files or installs dependencies.
5. Wait for Hermes to report completion or an explicit incomplete status before sending another
   requirement.

If authoring stops before validation completes, continue from the same project rather than
starting over:

```text
Please continue from the existing provider at <project-dir>. Finish implementation and local
validation. Do not connect, register, or publish yet.
```

Hermes preserves the confirmed identity and `.env`, finishes the remaining work, and reruns the
local checks without invoking the scaffold a second time.

## Included scaffold

The [`hermes-blocks-integration`](hermes-blocks-integration/SKILL.md) bundle contains:

- [`scripts/scaffold.mjs`](hermes-blocks-integration/scripts/scaffold.mjs), the deterministic
  provider scaffold;
- templates for `agent-card.json`, `handler.ts`, `call.mjs`, `package.json`, `tsconfig.json`,
  `.env`, and `.gitignore`;
- provider, composition, human-approval, and troubleshooting references.

The scaffold refuses to overwrite existing files. A generated provider keeps a `health` action
and a deterministic `call.mjs` client while Hermes adds the requested capability.

## Private-first lifecycle

Hermes completes local implementation, tests, typechecking, and `blocks check` before requesting
any account action. It then asks for separate approval at each step:

1. Authenticate the project.
2. Register it as Private + Free.
3. Start the provider as a managed process.
4. Send the health request.

Publishing is separate. Hermes must not accept publishing terms or run
`blocks publish --accept-terms` on the owner's behalf.

For Docker, never paste a Blocks API key into Telegram. Set `HERMES_CONTAINER_NAME` to the
host-side Docker name when creating the container. Hermes then returns one resolved `docker exec`
command that reads the key silently and runs `blocks login --api-key-stdin --write-env` inside the
provider project. Installations without that variable fall back to asking for the container name.
See the
[provider guide](hermes-blocks-integration/references/provider-agent-guide.md) for the exact
handoff.

## Validate the scaffold

The dry run validates arguments and renders every bundled output without writing a project:

```bash
node hermes-blocks-integration/scripts/scaffold.mjs \
  --project-dir /tmp/hermes-blocks-dry-run \
  --agent-name example_provider \
  --display-name "Example Provider" \
  --description "Returns a deterministic example artifact" \
  --dry-run
```
