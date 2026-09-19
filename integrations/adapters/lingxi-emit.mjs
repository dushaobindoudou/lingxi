#!/usr/bin/env node
// The one place a host event becomes a 灵犀 task event.
//
// WHY A PLUGIN EXISTS AT ALL, WHEN THERE IS ALREADY A SKILL
//
// A skill is ADVISORY: the model reads it and decides whether to act on it. That is the right
// shape for the interesting half - only something that has read the work can say whether it feels
// tender or frustrated - but it means the cat does nothing at all in the sessions where the model
// never thinks to call it. Which is most of them.
//
// A hook is DETERMINISTIC: the host fires it whether or not the model was paying attention.
// It cannot know how the work felt - it only sees lifecycle - so it can only ever produce the
// plain reaction. That is the trade, and both halves are worth having:
//
//     the plugin is the FLOOR   - the cat always responds to something happening
//     the skill is the CEILING  - when the model engages, the response knows what it is about
//
// So this adapter deliberately does NOT guess a mood. A plugin that invented one would be making
// up the single field the whole design rests on, and would then be wrong in a way nobody could
// see. It omits it, the app defaults to `focused`, and the skill overwrites it when the model has
// something real to say.
//
// USAGE
//
//   lingxi-emit.mjs --host claude          # Claude Code hook JSON on stdin
//   lingxi-emit.mjs --host codex           # Codex notify JSON, on argv or stdin
//   lingxi-emit.mjs --host generic         # already a task event; validated and forwarded
//   echo '{"state":"completed"}' | lingxi-emit.mjs
//
// It never fails loudly. A desktop pet must not be able to break the agent that is driving it,
// so every error path exits 0 and writes at most one line to stderr. If the cat is not running,
// nothing happens and the host does not care.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.LINGXI_PORT ?? 47811);
const TOKEN_FILE =
  process.env.LINGXI_TOKEN_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'com.dushaobin.lingxi-desktop', 'bridge-token');

/** Closed vocabularies - see integrations/schema/task-event.schema.json. */
const STATES = new Set(['queued', 'running', 'blocked', 'needs_input', 'completed', 'failed', 'cancelled']);
const KINDS = new Set(['build', 'test', 'deploy', 'review', 'search', 'write', 'chat', 'other']);
const MOODS = new Set(['focused', 'proud', 'tender', 'sad', 'frustrated', 'anxious', 'weary', 'playful', 'curious']);

function token() {
  if (process.env.LINGXI_TOKEN) return process.env.LINGXI_TOKEN.trim();
  try {
    return readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * The id this machine speaks as, when the environment does not carry one.
 *
 * Same file the MCP server and the `lingxi` CLI read, so all three paths sign the same name and
 * one machine never shows up on the cat as two different agents. `LINGXI_AGENT` still wins when
 * a host sets it for one invocation.
 */
const AGENT_FILE = join(homedir(), '.lingxi', 'agent.json');

function configuredAgent() {
  if (process.env.LINGXI_AGENT?.trim()) return process.env.LINGXI_AGENT.trim();
  try {
    const id = JSON.parse(readFileSync(AGENT_FILE, 'utf8'))?.id;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Claude Code hook payloads -> task events.
 *
 * Claude's hooks are CONVERSATION lifecycle, not task lifecycle: they say a turn started or
 * ended, nothing about what the turn was for. So `kind` is honestly "chat" and `mood` is absent.
 * Anything richer has to come from the model itself through the skill.
 */
function fromClaude(raw) {
  const event = raw.hook_event_name;
  const session = raw.session_id ?? 'claude-session';
  switch (event) {
    case 'SessionStart':
      return { state: 'queued', kind: 'chat', taskId: session };
    case 'UserPromptSubmit':
      return { state: 'running', kind: 'chat', taskId: session };
    case 'Notification':
      // Claude raises this when it is waiting on the user - a permission prompt, a question.
      // This is the one hook event that genuinely earns an interruption.
      return { state: 'needs_input', kind: 'chat', taskId: session, summary: raw.message };
    case 'Stop':
      return { state: 'completed', kind: 'chat', taskId: session };
    case 'StopFailure':
    case 'SubagentStop':
      return event === 'StopFailure'
        ? { state: 'failed', kind: 'chat', taskId: session, summary: raw.error_type }
        : null; // a subagent finishing is not a moment the user needs marked
    default:
      return null;
  }
}

/**
 * Codex `notify` payloads -> task events.
 *
 * Codex invokes `notify = ["<program>", "<arg>"]` with a JSON blob describing what happened.
 * The shape has moved around between versions, so this reads defensively and returns null for
 * anything it does not recognise rather than inventing a state.
 */
function fromCodex(raw) {
  const type = raw.type ?? raw.event ?? raw.kind;
  const session = raw['thread-id'] ?? raw.thread_id ?? raw.session_id ?? 'codex-session';
  const summary = raw['last-assistant-message'] ?? raw.message ?? undefined;
  switch (type) {
    case 'agent-turn-complete':
    case 'turn-ended':
    case 'turn_complete':
      return { state: 'completed', kind: 'chat', taskId: session, summary };
    case 'turn-started':
    case 'turn_started':
      return { state: 'running', kind: 'chat', taskId: session };
    case 'turn-failed':
    case 'error':
      return { state: 'failed', kind: 'chat', taskId: session, summary };
    case 'approval-requested':
    case 'input-requested':
      return { state: 'needs_input', kind: 'chat', taskId: session, summary };
    default:
      return null;
  }
}

/** Validate against the schema's vocabularies. Unknown values are dropped, not corrected. */
function clean(event, provider) {
  if (!event || !STATES.has(event.state)) return null;
  const out = { state: event.state, provider };
  if (KINDS.has(event.kind)) out.kind = event.kind;
  if (MOODS.has(event.mood)) out.mood = event.mood;
  if (typeof event.progress === 'number' && Number.isFinite(event.progress)) {
    out.progress = Math.max(0, Math.min(1, event.progress));
  }
  if (typeof event.summary === 'string' && event.summary.trim()) {
    out.summary = event.summary.trim().slice(0, 240);
  }
  if (typeof event.taskId === 'string') out.taskId = event.taskId.slice(0, 128);
  const agent = configuredAgent() || event.agent;
  if (agent) out.agent = String(agent).slice(0, 64);
  return out;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const hostIndex = args.indexOf('--host');
  const host = hostIndex >= 0 ? args[hostIndex + 1] : 'generic';

  // Codex passes its payload as an argv string; Claude pipes it on stdin. Accept either, from
  // either host, so a change in how a host invokes us is not a silent no-op.
  const inline = args.find((arg) => arg.trim().startsWith('{'));
  const text = inline ?? (await readStdin());
  if (!text.trim()) return;

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return; // not our payload; say nothing
  }

  const mapped = host === 'claude' ? fromClaude(raw) : host === 'codex' ? fromCodex(raw) : raw;
  const event = clean(mapped, host === 'generic' ? (raw.provider ?? 'generic') : host);
  if (!event) return; // a lifecycle event with no meaning for a cat

  const auth = token();
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/task-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: JSON.stringify(event),
      // Short and non-negotiable: the host is waiting on this, and a desktop pet is never worth
      // making someone's agent feel slow.
      signal: AbortSignal.timeout(1500),
    });
    if (response.status === 401) {
      process.stderr.write(`[lingxi] bridge rejected the token; check ${TOKEN_FILE}\n`);
    }
  } catch {
    // The app is not running, or is starting up. That is a completely normal state for a
    // desktop pet and must never surface as an error in the agent's output.
  }
}

main().catch(() => {});
