// Generic Blocks provider handler template.
// Copy to your project as handler.ts and implement the TODO hooks; keep the
// plumbing (parsing, persistence, identity resolution, awaited notify) as-is.
//
// Env (see env.template): BLOCKS_API_KEY, ME_AGENT, PENDING_STORE_PATH or DATA_DIR,
// plus whatever your notification channel needs (e.g. TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).
import type { StartTaskMessage, TaskContext, HandlerResult } from '@blocks-network/sdk';
import { TaskClient, textPart } from '@blocks-network/sdk';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Pending-request store — ON DISK, loaded fresh per call. Handlers are
// stateless: Blocks may run each task on a new instance, and approvals arrive
// minutes after the request, possibly via a different process.
// ---------------------------------------------------------------------------
interface PendingRequest {
  id: string;
  action: string;              // the domain action to perform on approval
  payload: Record<string, unknown>; // domain fields needed to perform it
  requesterEmail?: string;     // resolved identity of who asked
  requesterAgent?: string;     // Blocks agent to notify with the decision
  requestedAt: number;
}

const STORE_PATH = process.env.PENDING_STORE_PATH
  || `${process.env.DATA_DIR || '.'}/pending_approvals.json`;

function loadPending(): Map<string, PendingRequest> {
  try {
    const obj = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as Record<string, PendingRequest>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map<string, PendingRequest>();
  }
}

function savePending(map: Map<string, PendingRequest>): void {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(Object.fromEntries(map), null, 2));
  } catch (e) {
    console.error('Failed to persist pending requests:', e);
  }
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// ---------------------------------------------------------------------------
// Outbound A2A call — notify another agent over Blocks. MUST be awaited by
// callers: the task context is torn down when the handler returns, which kills
// fire-and-forget calls silently. Own try/catch so a dead peer can't fail the
// main task.
// ---------------------------------------------------------------------------
async function notifyRequesterAgent(targetAgent: string, payload: unknown): Promise<void> {
  try {
    const apiKey = process.env.BLOCKS_API_KEY;
    if (!apiKey || !targetAgent) return;
    const client = await TaskClient.create({ billingMode: 'free', apiKey });
    try {
      const s = await client.sendMessage({
        agentName: targetAgent,
        // partId (2nd arg) is REQUIRED and must equal the target card's io.inputs[0].id
        requestParts: [textPart(JSON.stringify(payload), 'request')],
      });
      await s.waitForTerminal(30_000);
      s.close();
    } finally {
      client.destroy();
    }
  } catch (e: any) {
    console.log('[notify] failed to notify agent:', e?.message || e);
  }
}

// ---------------------------------------------------------------------------
// Identity resolution — NO hardcoded people. Explicit request fields first,
// then Blocks-provided caller identity, else null (caller must refuse).
// ---------------------------------------------------------------------------
function looksLikeEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

function resolveRequesterEmail(request: any, task: StartTaskMessage): { email: string; source: string } | null {
  const explicit = String(request.requesterEmail || request.attendees || '')
    .split(',').map((s) => s.trim()).filter(looksLikeEmail);
  if (explicit.length) return { email: explicit.join(','), source: 'request' };

  const claims = (task.callerClaims || {}) as Record<string, unknown>;
  for (const [source, val] of [
    ['callerClaims.email', claims.email],
    ['callerClaims.sub', claims.sub],
    ['ownerId', task.ownerId],
  ] as const) {
    if (looksLikeEmail(val)) return { email: (val as string).trim(), source };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Human notification hook — tell THIS agent's owner about a pending request or
// a decision. Implement for your channel (Telegram reply-keyboard with
// "✅ approve <id>" / "❌ reject <id>" button labels is the shipped pattern —
// see references/human-in-the-loop.md). Tokens/chat ids from env ONLY.
// ---------------------------------------------------------------------------
async function notifyOwner(text: string, pendingId?: string): Promise<boolean> {
  // TODO: send `text` to your owner's channel; when pendingId is set, attach
  // approve/reject buttons whose labels are "✅ approve <pendingId>" etc.
  console.log(`[notifyOwner]${pendingId ? ` [${pendingId}]` : ''} ${text}`);
  return true;
}

// ---------------------------------------------------------------------------
// Domain action hook — perform the real capability when a request is approved
// (or when called directly by the owner). Return a JSON-serializable result.
// ---------------------------------------------------------------------------
async function performDomainAction(action: string, payload: Record<string, unknown>): Promise<unknown> {
  // TODO: implement your capability here (create the event / file the doc / run the job …)
  throw new Error(`Domain action not implemented: ${action}`);
}

// Natural-language approve/reject matching (emoji-tolerant, id-extracting) —
// this is what makes button-labels-as-commands work.
const APPROVE_RE = /(^|\s)(✅|approve|yes|yeah|yep|sure|accept|ok|okay|confirm)(\s|$)/i;
const REJECT_RE = /(^|\s)(❌|reject|no|nope|deny|decline|cancel)(\s|$)/i;

function jsonArtifact(obj: unknown): HandlerResult {
  return {
    artifacts: [{ data: JSON.stringify(obj, null, 2), mimeType: 'application/json' }],
  };
}

export default async function handler(
  task: StartTaskMessage,
  ctx?: TaskContext,
): Promise<HandlerResult> {
  try {
    // Parse defensively: JSON first, else treat the raw text as a natural-language action.
    const rawText = task.requestParts?.[0]?.text || '{}';
    let request: any;
    try {
      request = JSON.parse(rawText);
    } catch {
      request = { action: rawText.trim() };
    }

    const { action, requestId } = request;
    ctx?.reportStatus(`Processing ${action}...`);

    switch (action) {
      // -----------------------------------------------------------------
      // TODO: your direct domain actions (owner-invoked, no approval), e.g.:
      // case 'list': { ... return jsonArtifact({ action, status: 'success', ... }); }
      // -----------------------------------------------------------------

      case 'request_create': {
        // A peer agent asks this agent to do something — needs owner approval.
        const requester = resolveRequesterEmail(request, task);
        if (!requester) {
          return jsonArtifact({
            action, status: 'error',
            message: 'No requester identity found. Include "requesterEmail":"<email>" (a display name is not enough).',
          });
        }
        console.log(`[request_create] requester resolved from ${requester.source}: ${requester.email}`);

        const reqId = generateRequestId();
        const pending: PendingRequest = {
          id: reqId,
          action: String(request.performAction || 'perform'), // domain action to run on approval
          payload: request,
          requesterEmail: requester.email,
          requesterAgent: request.requesterAgent, // return address for the decision
          requestedAt: Date.now(),
        };
        const store = loadPending();
        store.set(reqId, pending);
        savePending(store);

        // AWAIT (task-teardown rule).
        await notifyOwner(`Incoming request from ${requester.email}: ${request.summary || pending.action}`, reqId);

        return jsonArtifact({
          action, status: 'pending_approval', requestId: reqId,
          message: 'Request pending owner approval.',
          approve_command: `{"action": "approve", "requestId": "${reqId}"}`,
          reject_command: `{"action": "reject", "requestId": "${reqId}"}`,
        });
      }

      case 'approve':
      case 'reject': {
        if (!requestId) return jsonArtifact({ action, status: 'error', message: 'Missing requestId' });
        const store = loadPending();
        const pending = store.get(requestId);
        if (!pending) return jsonArtifact({ action, status: 'error', message: 'Request not found or already processed' });

        let result: unknown = null;
        if (action === 'approve') {
          result = await performDomainAction(pending.action, pending.payload);
        }
        store.delete(requestId);
        savePending(store);

        // Notify the requester's agent over Blocks — BOTH outcomes, awaited.
        if (pending.requesterAgent) {
          await notifyRequesterAgent(pending.requesterAgent, {
            action: 'notify_approval',
            decision: action === 'approve' ? 'approved' : 'rejected',
            requestId,
            summary: pending.payload.summary,
            result,
          });
        }

        return jsonArtifact({ action, status: 'success', requestId, result });
      }

      case 'notify_approval': {
        // A decision about a request THIS agent sent earlier. Notify-only:
        // the approver already performed the action exactly once — do NOT repeat it.
        const verb = request.decision === 'approved' ? '✅ approved' : '❌ rejected';
        await notifyOwner(`Your request "${request.summary || request.requestId}" was ${verb}.`);
        return jsonArtifact({ action, status: 'success', message: `Owner notified: ${request.decision}` });
      }

      case 'get_approval':
      case 'pending': {
        const pending = Array.from(loadPending().values());
        return jsonArtifact({ action: 'pending', status: 'success', count: pending.length, requests: pending });
      }

      default: {
        // Natural language (incl. button-label taps like "✅ approve req_x").
        const text = rawText.trim();
        const idMatch = text.toLowerCase().match(/req_[a-z0-9_-]+/);
        const isApprove = APPROVE_RE.test(text) && !REJECT_RE.test(text);
        const isReject = REJECT_RE.test(text) && !APPROVE_RE.test(text);

        if (isApprove || isReject) {
          const store = loadPending();
          const target = idMatch ? store.get(idMatch[0]) : Array.from(store.values()).pop();
          if (!target) return jsonArtifact({ status: 'error', message: 'No pending requests to decide on' });
          // Re-dispatch through the structured path.
          return handler({
            ...task,
            requestParts: [{ ...task.requestParts![0], text: JSON.stringify({ action: isApprove ? 'approve' : 'reject', requestId: target.id }) }],
          } as StartTaskMessage, ctx);
        }

        return jsonArtifact({
          action: 'help', status: 'error',
          message: 'Unknown action. Generic actions: request_create, approve, reject, get_approval, notify_approval. Add your domain actions to this list.',
          examples: [
            '{"action": "request_create", "summary": "…", "requesterEmail": "peer@example.com", "requesterAgent": "peer_hermes_domain"}',
            '{"action": "approve", "requestId": "req_123"}',
            '{"action": "get_approval"}',
          ],
        });
      }
    }
  } catch (error: any) {
    console.error('Handler error:', error);
    return jsonArtifact({ status: 'error', message: error?.message || String(error) });
  }
}
