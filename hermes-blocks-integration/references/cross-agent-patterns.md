# Cross-agent patterns

Read this reference when Hermes calls another Blocks agent, decodes artifacts, or composes several
providers.

## One request/response call

```ts
import { TaskClient, decodeInlineArtifact, textPart } from '@blocks-network/sdk';

const client = await TaskClient.create({
  billingMode: process.env.BLOCKS_BILLING_MODE || 'free',
  apiKey: process.env.BLOCKS_API_KEY,
});

let session;
try {
  session = await client.sendMessage({
    agentName: targetAgent,
    requestParts: [textPart(JSON.stringify(payload), targetInputId)],
  });
  await session.waitForTerminal(30_000);

  for (const ref of session.listArtifacts()) {
    const bytes = ref.kind === 'inline' && ref.data
      ? decodeInlineArtifact(ref)
      : (await session.downloadArtifact(ref)).data;
    console.log(new TextDecoder().decode(bytes));
  }
} finally {
  session?.close();
  client.destroy();
}
```

Rules:

- `targetInputId` must equal the target card's input id. The generated provider uses `request`.
- Use an explicit timeout.
- Treat zero artifacts, invalid JSON, and a JSON result with `status: "error"` as failures when the
  card guarantees a JSON output.
- Close the session and destroy the client on every path.

The generated `call.mjs` implements this pattern and should be preferred over improvised one-shot
SDK code.

## Nested calls from a provider

A provider may delegate work to another Blocks agent. Await the nested task before returning:

```ts
const result = await callAgent(targetAgent, payload);
return artifact({ status: 'success', result });
```

Fire-and-forget calls are unsafe because handler teardown can kill in-flight work without a useful
error. Budget the downstream timeout inside the caller's `runtime.maxRunningTimeSec` and define how
downstream failure maps to the caller's result artifact.

Avoid accidental cycles. If agents can call one another, carry a hop count or trace id and refuse
requests beyond a small configured depth.

## Peer aliases

When natural-language Hermes workflows refer to stable aliases, keep the mapping in data rather
than code:

```json
{
  "research": { "agentName": "research_agent" },
  "review": { "agentName": "review_agent" }
}
```

Resolve an alias to `agentName` before calling Blocks. Add email, tenancy, or routing metadata only
when the capability needs it. Do not make a peer registry mandatory for direct calls.

## Private agents

Registration does not automatically grant cross-organization access. Complete the Blocks invite
flow and inspect grants before debugging SDK code. For symmetric setups, verify the required access
in each direction.
