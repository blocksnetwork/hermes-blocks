// Consumer smoke test — round-trips a real task through Blocks to this agent.
// Usage: npx tsx trigger.ts [action]   (default: get_approval — safe, read-only)
import 'dotenv/config';
import { TaskClient, textPart, decodeInlineArtifact } from '@blocks-network/sdk';
import type { ProgressEvent, ArtifactEvent, TerminalEvent } from '@blocks-network/sdk';

const AGENT_NAME = process.env.ME_AGENT || process.env.LOCAL_AGENT_NAME || '<OWNER>_hermes_<DOMAIN>';

async function main() {
  const action = process.argv[2] || 'get_approval';
  const request = JSON.stringify({ action });
  console.log(`Sending to ${AGENT_NAME}:`, request);

  const client = await TaskClient.create({
    billingMode: 'free',
    apiKey: process.env.BLOCKS_API_KEY,
  });

  const session = await client.sendMessage({
    agentName: AGENT_NAME,
    // partId (2nd arg) is REQUIRED and must equal the card's io.inputs[0].id
    requestParts: [textPart(request, 'request')],
  });

  console.log('Task created:', session.taskId);

  session.onProgress((event: ProgressEvent) => {
    console.log('[progress]', event.message ?? event.progress ?? '');
  });
  session.onArtifact(async (event: ArtifactEvent) => {
    const ref = event.artifactRef;
    const bytes = ref.kind === 'inline' && ref.data
      ? decodeInlineArtifact(ref)
      : (await session.downloadArtifact(ref)).data;
    console.log('[artifact]', new TextDecoder().decode(bytes));
  });
  session.onTerminal((_event: TerminalEvent) => {
    console.log('[done] Task complete');
    session.close();
    client.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
