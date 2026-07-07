// One-shot approve/reject/pending helper for THIS agent (person-independent).
// The Hermes agent should run THIS instead of writing its own script.
//
//   node runbook.mjs approve req_xxx     → approve a pending request
//   node runbook.mjs reject  req_xxx     → reject it
//   node runbook.mjs pending             → list pending requests
//
// Resolves the SDK/.env and the agent name relative to THIS file's own directory,
// so the same script works in any agent's folder with no hardcoded identity —
// and works from any cwd (cron, CI, chat-driven shells).
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const AGENT_NAME = process.env.LOCAL_AGENT_NAME || process.env.ME_AGENT || path.basename(__dir);

// SDK is ESM-only; import it (and dotenv) by absolute file URL so resolution
// never depends on the caller's cwd.
const { config: loadEnv } = await import(pathToFileURL(path.join(__dir, 'node_modules/dotenv/lib/main.js')).href);
const { TaskClient, textPart, decodeInlineArtifact } = await import(
  pathToFileURL(path.join(__dir, 'node_modules/@blocks-network/sdk/dist/index.js')).href
);

loadEnv({ path: path.join(__dir, '.env') });

const [, , action = 'pending', requestId] = process.argv;
const payload = action === 'approve' || action === 'reject'
  ? { action, requestId }
  : { action: 'get_approval' };

const client = await TaskClient.create({ billingMode: 'free', apiKey: process.env.BLOCKS_API_KEY });
try {
  const session = await client.sendMessage({
    agentName: AGENT_NAME,
    // partId (2nd arg) is REQUIRED and must equal the card's io.inputs[0].id
    requestParts: [textPart(JSON.stringify(payload), 'request')],
  });
  await session.waitForTerminal(60_000);
  for (const ref of session.listArtifacts()) {
    const bytes = ref.kind === 'inline' && ref.data
      ? decodeInlineArtifact(ref)
      : (await session.downloadArtifact(ref)).data;
    console.log(new TextDecoder().decode(bytes));
  }
  session.close();
} finally {
  client.destroy();
}
