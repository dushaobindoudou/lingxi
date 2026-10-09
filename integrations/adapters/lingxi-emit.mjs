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
//   lingxi-emit.mjs --host cursor          # Cursor hook JSON; hook_event_name selects the arm
//   lingxi-emit.mjs --host generic         # already a task event; validated and forwarded
//   echo '{"state":"completed"}' | lingxi-emit.mjs
//
// It never fails loudly. A desktop pet must not be able to break the agent that is driving it,
// so every error path exits 0 and writes at most one line to stderr. If the cat is not running,
// nothing happens and the host does not care.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join } from 'node:path';

const PORT = Number(process.env.LINGXI_PORT ?? 47811);
const TOKEN_FILE =
  process.env.LINGXI_TOKEN_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'com.dushaobin.lingxi-desktop', 'bridge-token');

/** Closed vocabularies - see integrations/schema/task-event.schema.json. */
const STATES = new Set([
  'queued', 'running', 'blocked', 'needs_input', 'needs_approval', 'completed', 'failed', 'cancelled',
]);
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

/** Longest session name the cat shows - the app's SESSION_LABEL_MAX_CHARS. */
const SESSION_LABEL_MAX = 40;
/** How much of a transcript's tail is read for its title - the app's TRANSCRIPT_TAIL_BYTES. */
const TRANSCRIPT_TAIL_BYTES = 512 * 1024;

/**
 * What to call a Claude Code session, as claude_session_label in the app does: the `/rename`
 * title, else Claude Code's generated title, else the project folder. Claude Code re-appends
 * both title records after every turn, so the newest copy is always in the transcript's tail.
 * Only a `.jsonl` path is opened, and only the title fields are kept.
 */
function claudeSessionLabel(raw) {
  const clip = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, SESSION_LABEL_MAX) : null);
  // SessionStart and UserPromptSubmit carry the title in the payload itself.
  if (clip(raw.session_title)) return clip(raw.session_title);
  const path = raw.transcript_path;
  if (typeof path === 'string' && isAbsolute(path) && extname(path) === '.jsonl') {
    let fd;
    try {
      fd = openSync(path, 'r');
      const { size } = fstatSync(fd);
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      let generated = null;
      for (const line of buffer.toString('utf8').split('\n').reverse()) {
        if (!line.includes('-title"')) continue;
        let record;
        try { record = JSON.parse(line); } catch { continue; } // the tail's first line is partial
        if (record.type === 'custom-title' && clip(record.customTitle)) return clip(record.customTitle);
        if (record.type === 'ai-title' && !generated) generated = clip(record.aiTitle);
      }
      if (generated) return generated;
    } catch {
      // unreadable transcript: fall through to the folder
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  return typeof raw.cwd === 'string' ? clip(basename(raw.cwd)) : null;
}

/** A mapped Claude event, told which session it is and what that session is called. */
function withClaudeSession(event, raw) {
  if (!event || typeof raw.session_id !== 'string') return event;
  return { ...event, session: raw.session_id, label: claudeSessionLabel(raw) };
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
      // What the user typed stays with the user (docs/09): the running row is
      // lifecycle only, never the prompt text.
      return { state: 'running', kind: 'chat', taskId: session };
    case 'Notification': {
      // Claude raises this for permission prompts, plain questions, and notices that wait on nobody
      // (auth_success, computer_use_enter, ...). `notification_type` says which on current Claude
      // Code; the message text is the fallback for versions without it. Must match
      // normalize_claude_hook_event in the app.
      const message = String(raw.message ?? '');
      const type = raw.notification_type;
      let state;
      if (type === 'permission_prompt' || type === 'worker_permission_prompt') state = 'needs_approval';
      else if (['idle_prompt', 'agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog'].includes(type)) state = 'needs_input';
      else if (typeof type === 'string') return null; // not waiting on the user
      else state = /permission|approve|allow|授权|批准|允许/i.test(message) ? 'needs_approval' : 'needs_input';
      const tool = message.split('permission to use ')[1]?.trim().replace(/\.$/, '').slice(0, 40);
      return {
        state,
        kind: 'chat',
        taskId: session,
        echo: true,
        summary: state === 'needs_approval' && tool ? `想用 ${tool}，等你批一下` : message,
        result: state === 'needs_approval' && tool ? `想用 ${tool}，等你批一下` : undefined,
      };
    }
    case 'Stop':
      // The reply itself goes to the local app, which cuts one line from it for the bubble - or
      // turns the event into needs_input when the reply ends on a question - and keeps none of
      // it (TaskEvent::result). Perceived, not collected.
      return { state: 'completed', kind: 'chat', taskId: session, result: raw.last_assistant_message };
    case 'PermissionRequest': {
      // The dialog as it opens (the Notification for it is a later echo). AskUserQuestion is
      // drawn as a permission dialog, so it arrives here too. Must match the app's mapper.
      const tool = String(raw.tool_name ?? '');
      const input = raw.tool_input ?? {};
      if (tool === 'AskUserQuestion') {
        return { state: 'needs_input', kind: 'chat', taskId: session, summary: '有个问题等你选', result: input.questions?.[0]?.question };
      }
      if (tool === 'ExitPlanMode') {
        return { state: 'needs_approval', kind: 'chat', taskId: session, summary: '计划写好了，等你过目', result: '计划写好了，等你过目' };
      }
      const short = tool.split('__').pop() || '工具';
      const file = typeof input.file_path === 'string' ? input.file_path.split('/').pop() : null;
      const what = tool === 'Bash' && input.description ? `想跑：${input.description}`
        : file && ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool) ? `想改 ${file}，等你批一下`
        : `想用 ${short}，等你批一下`;
      return { state: 'needs_approval', kind: 'chat', taskId: session, summary: `想用 ${short}，等你批一下`, result: what };
    }
    case 'TaskCompleted':
      // A todo ticked off: updates the session's row, silently.
      return { state: 'running', kind: 'chat', taskId: session, summary: '完成了一项待办', result: raw.task_subject ? `完成：${raw.task_subject}` : undefined };
    case 'SessionEnd':
      return null; // the generic schema has no "gone"; the raw-payload path removes the row
    case 'StopFailure':
    case 'SubagentStop':
      return event === 'StopFailure'
        ? { state: 'failed', kind: 'chat', taskId: session, summary: `本轮因错误终止（${raw.error_type ?? 'unknown'}）` }
        : null; // a subagent finishing is not a moment the user needs marked
    default:
      return null;
  }
}

/**
 * Whether this "turn" is Codex naming a task rather than talking to the user.
 *
 * When a task is started, the Codex app asks the model for a title in a separate, throwaway
 * thread, and that thread's end fires `notify` like any other turn. Its reply is the title -
 * plain text in one version of the prompt, `{"title":"…","description":"…"}` in another - so the
 * cat announced "Codex 回复结束" for a turn the user never saw, and read the JSON out loud.
 *
 * Recognised by either end of the turn: the input is the generator's own instruction (it opens
 * with "You are a helpful assistant…" or "Generate a…", and talks about a title for a prompt),
 * or the reply is a JSON object with a `title`. Both are needed - neither prompt has a stable
 * wording across versions, and only one of them answers in JSON. A user who asks for a title
 * for something of theirs does not open with that instruction and does not mention a prompt.
 *
 * Mirrored by lib.rs's is_codex_title_turn, case for case.
 */
function isCodexTitleTurn(raw) {
  const inputs = raw['input-messages'] ?? raw.input_messages;
  const first = Array.isArray(inputs) && typeof inputs[0] === 'string' ? inputs[0] : '';
  const head = first.slice(0, 600).toLowerCase().trimStart();
  if ((head.startsWith('you are a helpful assistant') || head.startsWith('generate a'))
    && head.includes('title') && head.includes('prompt')) {
    return true;
  }
  const reply = raw['last-assistant-message'] ?? raw.message;
  if (typeof reply !== 'string' || !reply.trim().startsWith('{')) return false;
  try {
    const parsed = JSON.parse(reply);
    return parsed !== null && typeof parsed === 'object' && typeof parsed.title === 'string';
  } catch {
    return false;
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
  if (isCodexTitleTurn(raw)) return null;
  const type = raw.type ?? raw.event ?? raw.kind;
  const session = raw['thread-id'] ?? raw.thread_id ?? raw.session_id ?? 'codex-session';
  const result = raw['last-assistant-message'] ?? raw.message ?? undefined;
  switch (type) {
    case 'agent-turn-complete':
    case 'turn-ended':
    case 'turn_complete':
      return { state: 'completed', kind: 'chat', taskId: session, session, summary: 'Codex 回复结束', result };
    case 'turn-started':
    case 'turn_started':
      return { state: 'running', kind: 'chat', taskId: session, session };
    case 'turn-failed':
    case 'error':
      return { state: 'failed', kind: 'chat', taskId: session, session, summary: '本轮因错误终止', result };
    case 'approval-requested':
      return { state: 'needs_approval', kind: 'chat', taskId: session, session, result };
    case 'input-requested':
      return { state: 'needs_input', kind: 'chat', taskId: session, session, result };
    default:
      return null;
  }
}

/**
 * Cursor hook payloads -> task events.
 *
 * Cursor's hooks are conversation lifecycle, same honesty rule as Claude: `kind` is "chat"
 * and `mood` is omitted. The hook script stamps `hook_event_name` because Cursor does not
 * put the event name in every payload (sessionStart and stop use different field sets).
 * `stop` is one agent turn ending, not proof the user's task is done.
 * The sidebar title is the name of the chat when it was opened. Later turns
 * drift off it, so it is never used as the summary, and neither is the prompt. What the
 * turn actually did comes from the model.
 */
function fromCursor(raw) {
  const event = raw.hook_event_name;
  const session = raw.session_id ?? raw.conversation_id ?? 'cursor-session';
  switch (event) {
    case 'sessionStart':
      return { state: 'queued', kind: 'chat', taskId: session, session, summary: '会话开始' };
    // Never the prompt itself: what the user typed is theirs, and "不采集任务正文" (docs/09) holds
    // for every host. The event says a turn started, which is all the cat needs.
    case 'beforeSubmitPrompt':
      return { state: 'running', kind: 'chat', taskId: session, session, summary: '新一轮对话开始' };
    case 'stop': {
      const status = raw.status ?? 'completed';
      if (status === 'error') {
        return { state: 'failed', kind: 'chat', taskId: session, session, summary: '本轮因错误终止' };
      }
      if (status === 'aborted') {
        return { state: 'cancelled', kind: 'chat', taskId: session, session, summary: '本轮已中止' };
      }
      return { state: 'completed', kind: 'chat', taskId: session, session, summary: '本轮回复结束' };
    }
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
  if (event.echo === true) out.echo = true;
  // Display only: which session this is, and its name - see TaskEvent::session/label in the app.
  if (typeof event.session === 'string' && event.session) out.session = event.session.slice(0, 128);
  if (typeof event.label === 'string' && event.label.trim()) out.label = event.label.trim().slice(0, SESSION_LABEL_MAX);
  if (typeof event.result === 'string' && event.result.trim()) out.result = event.result.slice(0, 4000);
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

  const mapped = host === 'claude' ? withClaudeSession(fromClaude(raw), raw)
    : host === 'codex' ? fromCodex(raw)
    : host === 'cursor' ? fromCursor(raw)
    : raw;
  // The configured identity is the better provider name when there is one: it is what the CLI and
  // the MCP server both report, so all three paths describe the same tool by the same name rather
  // than appearing as separate sources.
  const provider = configuredAgent() ?? (host === 'generic' ? (raw.provider ?? 'generic') : host);
  const event = clean(mapped, provider);
  if (!event) return; // a lifecycle event with no meaning for a cat
  // A host's own lifecycle event, not an agent's report: the app never reads its summary aloud
  // as a task result, and lets it stand down when the agent already reported the turn itself.
  if (host !== 'generic') event.origin = 'hook';

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
