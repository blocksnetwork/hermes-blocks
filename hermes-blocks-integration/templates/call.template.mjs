// Deterministic Blocks consumer and provider smoke test.
//
//   node call.mjs <target_agent> '{"action":"health"}'
//
// The target defaults to BLOCKS_TARGET_AGENT, then BLOCKS_AGENT_NAME. The
// payload defaults to the read-only health action.
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { TaskClient, decodeInlineArtifact, textPart } from '@blocks-network/sdk';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(projectDir, '.env') });

const [, , targetArg, payloadArg = '{"action":"health"}'] = process.argv;
const targetAgent = targetArg || process.env.BLOCKS_TARGET_AGENT || process.env.BLOCKS_AGENT_NAME;
const inputId = process.env.BLOCKS_TARGET_INPUT_ID || 'request';
const timeoutMs = Number(process.env.BLOCKS_TIMEOUT_MS || 120_000);
const maxRequestBytes = Number(process.env.BLOCKS_MAX_REQUEST_BYTES || 1_048_576);

if (!process.env.BLOCKS_API_KEY) {
  throw new Error(`BLOCKS_API_KEY is missing from ${path.join(projectDir, '.env')}`);
}
if (!targetAgent) {
  throw new Error('Pass a target agent or set BLOCKS_TARGET_AGENT/BLOCKS_AGENT_NAME');
}
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error('BLOCKS_TIMEOUT_MS must be a positive integer');
}
if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes <= 0) {
  throw new Error('BLOCKS_MAX_REQUEST_BYTES must be a positive integer');
}
if (new TextEncoder().encode(payloadArg).byteLength > maxRequestBytes) {
  throw new Error(`Payload exceeds ${maxRequestBytes} bytes`);
}

let payload;
try {
  payload = JSON.parse(payloadArg);
} catch {
  throw new Error('Payload must be a valid JSON object string');
}
if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
  throw new Error('Payload must be a JSON object');
}

const client = await TaskClient.create({
  billingMode: 'free',
  apiKey: process.env.BLOCKS_API_KEY,
});

let session;
try {
  session = await client.sendMessage({
    agentName: targetAgent,
    requestParts: [textPart(JSON.stringify(payload), inputId)],
  });
  await session.waitForTerminal(timeoutMs);

  const artifacts = session.listArtifacts();
  if (!artifacts.length) throw new Error('Blocks task completed without a result artifact');

  let jsonArtifactFound = false;
  for (const ref of artifacts) {
    if (typeof ref.mimeType !== 'string') {
      throw new Error('Provider returned an artifact without a MIME type');
    }
    const bytes = ref.kind === 'inline' && ref.data
      ? decodeInlineArtifact(ref)
      : (await session.downloadArtifact(ref)).data;
    const text = new TextDecoder().decode(bytes);
    if (ref.mimeType.toLowerCase().startsWith('application/json')) {
      jsonArtifactFound = true;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Provider returned an invalid JSON artifact');
      }
      console.log(JSON.stringify(parsed, null, 2));
      if (parsed?.status === 'error') {
        throw new Error(`Provider returned an error: ${parsed.message || 'unspecified error'}`);
      }
    } else {
      console.log(text);
    }
  }
  if (!jsonArtifactFound) throw new Error('Provider returned no application/json artifact');
} finally {
  session?.close();
  client.destroy();
}
