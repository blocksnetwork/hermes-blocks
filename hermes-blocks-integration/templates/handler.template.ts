// Generic Hermes capability adapter for Blocks.
// Keep transport parsing and artifact construction here; put business logic in
// separate functions/modules and add each public action to agent-card.json.
import type { HandlerResult, StartTaskMessage, TaskContext } from '@blocks-network/sdk';

type RequestPayload = {
  action: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

// Provider-side input is pinned to the published card. Consumer targets may
// use a different id via BLOCKS_TARGET_INPUT_ID in call.mjs.
const INPUT_ID = 'request';

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const MAX_REQUEST_BYTES = positiveIntegerEnv('BLOCKS_MAX_REQUEST_BYTES', 1_048_576);

function artifact(value: unknown): HandlerResult {
  return {
    artifacts: [{
      data: JSON.stringify(value, null, 2),
      mimeType: 'application/json',
      outputId: 'result',
    }],
  };
}

function parseRequest(task: StartTaskMessage): RequestPayload {
  const part = task.requestParts?.find((candidate) => candidate.partId === INPUT_ID);
  if (!part) throw new Error(`Missing request part: ${INPUT_ID}`);
  if (part.contentType && !part.contentType.toLowerCase().startsWith('application/json')) {
    throw new Error(`Unsupported content type: ${part.contentType}`);
  }

  const raw = part.text?.trim() || '';
  if (!raw) throw new Error('Request text is empty');
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new Error(`Request exceeds ${MAX_REQUEST_BYTES} bytes`);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Request must be a JSON object');
    }
    if (typeof parsed.action !== 'string' || !parsed.action.trim()) {
      throw new Error('Request must include a non-empty string action');
    }
    return parsed as RequestPayload;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Request text must be valid JSON');
    throw error;
  }
}

export default async function handler(
  task: StartTaskMessage,
  ctx?: TaskContext,
): Promise<HandlerResult> {
  try {
    const request = parseRequest(task);
    ctx?.reportStatus(`Processing ${request.action}...`);

    switch (request.action) {
      case 'health':
        return artifact({
          action: 'health',
          status: 'ok',
          agent: process.env.BLOCKS_AGENT_NAME || null,
        });

      // Add domain actions here. Example:
      // case 'search':
      //   return artifact({ action: 'search', status: 'success', result: await search(request.payload) });

      default:
        return artifact({
          action: request.action,
          status: 'error',
          message: 'Unsupported action. Add it to agent-card.json and handler.ts.',
          supportedActions: ['health'],
        });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Log only the error class. Domain code should return deliberately sanitized
    // public messages rather than embedding payloads, credentials, or URLs.
    console.error('Handler request failed:', error instanceof Error ? error.name : 'UnknownError');
    return artifact({ status: 'error', message: message.slice(0, 500) });
  }
}
