#!/usr/bin/env node
//
// lingxi-quota-guard.mjs - watch WorkBuddy's own token/credit meters and let the cat speak up
//                          before a session runs out of room.
//
// WHY THIS IS A SEPARATE HOOK AND NOT PART OF lingxi-emit.mjs
//
// The emitter's job is to translate a host event into a task event. This one's job is to read
// the host's private usage database, which is a different kind of coupling entirely: it is not
// a published contract, it can change with any app update, and it must therefore be allowed to
// silently stop working. Keeping it in its own process means that if the schema moves under us,
// the emitter - the part that actually matters - is untouched.
//
// WHAT IS ACTUALLY MEASURABLE (checked against WorkBuddy on 2026-09-30)
//
//   ~/.workbuddy/workbuddy.db  ->  table session_usage(session_id, used, size, updated_at, credit_json)
//
//   used / size   the context window consumed by this session. `size` also appears on the
//                 sessions row as context_window. This is the one meter that is genuinely local,
//                 genuinely live, and refreshed on every message.
//   credit_json   a map of request-id -> credits burned by that request. Sum it and you have
//                 what THIS session has cost so far.
//
//   What is NOT here: the account balance. WorkBuddy ships static copy for the run-out state
//   ("credit 额度已用完，立即升级订阅" and an upgrade URL) but the remaining allowance itself is
//   never written to disk - it lives behind an API the UI calls. So this guard can tell you
//   "this session is nearly full" and "this session has burned N credits", and it can NOT tell
//   you "you have 12 credits left on your plan". Do not promise the third one.
//
// Every error path exits 0. A desktop pet's opinion about your token budget must never be able
// to break, slow, or print into the agent that is driving it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.LINGXI_PORT ?? 47811);
const TOKEN_FILE =
  process.env.LINGXI_TOKEN_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'com.dushaobin.lingxi-desktop', 'bridge-token');

const DB = process.env.LINGXI_WB_DB ?? join(homedir(), '.workbuddy', 'workbuddy.db');
const STATE_FILE = process.env.LINGXI_QUOTA_STATE ?? join(homedir(), '.lingxi', 'quota-guard-state.json');
const DEBUG = process.env.LINGXI_QUOTA_DEBUG === '1';

/**
 * The context-window steps, as a fraction used. These are not invented: WorkBuddy ships them
 * in its product config as tokenUsageThresholds.inputTokens (warning .6, critical .7,
 * emergency .9). Override with LINGXI_QUOTA_STEPS="0.5,0.75,0.9" if you want to be told sooner.
 * The last entry is the one that says "it is about to compact".
 */
const STEPS = (process.env.LINGXI_QUOTA_STEPS ?? '0.6,0.7,0.9')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0 && n < 1)
  .sort((a, b) => a - b);

/** Optional: speak up once this session has burned this many credits. Unset means never. */
const CREDIT_BUDGET = Number(process.env.LINGXI_QUOTA_CREDIT_BUDGET ?? 0);

/**
 * Priorities are ambient < status < report < alert. Deliberately nothing here is `alert`: a
 * nagging pet that outranks the agent's own report is a pet people turn off.
 */
const TIERS = [
  { at: STEPS[0] ?? 0.6, priority: 'status', line: (p) => `上下文用了 ${p}%，我开始觉得挤了。` },
  { at: STEPS[1] ?? 0.7, priority: 'report', line: (p) => `上下文 ${p}% 了，再攒下去该压缩了。` },
  { at: STEPS[2] ?? 0.9, priority: 'report', line: (p) => `上下文 ${p}%，这轮再聊真的要撑满了。` },
];

function debug(...parts) {
  if (DEBUG) process.stderr.write(`[lingxi-quota] ${parts.join(' ')}\n`);
}

/**
 * Read one session's usage. Two engines, one answer.
 *
 * python3 goes FIRST, which is the opposite of what "the hook is already a node process" would
 * suggest. The reason is noise: node:sqlite is marked experimental, and node writes
 * `ExperimentalWarning: SQLite is an experimental feature` to stderr *unconditionally* - it is
 * printed even when a 'warning' listener is installed, so the script cannot suppress it from
 * the inside. That lands in the host's hook output. python3's sqlite3 has no such problem and
 * has been in the standard library forever. node:sqlite stays as the fallback for machines
 * without python (a Windows install, mostly).
 *
 * Either way a failure yields null and the guard says nothing: a missing meter is never an
 * error worth surfacing.
 */
async function sessionUsage(sessionId) {
  const python = process.env.LINGXI_PYTHON ?? 'python3';
  const script = [
    'import sqlite3,json,sys',
    'c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)',
    'r=c.execute("select used,size,credit_json from session_usage where session_id=?",(sys.argv[2],)).fetchone()',
    'if not r: print("null"); raise SystemExit',
    'cj=r[2]',
    'try: s=sum(json.loads(cj).values()) if cj else None',
    'except Exception: s=None',
    'print(json.dumps({"used":r[0],"size":r[1],"credit":s}))',
  ].join('\n');
  try {
    // stdio is explicit: execFileSync inherits stderr from the parent by default, so a python
    // traceback would otherwise land in the agent's hook output. A silent meter is fine; a
    // stack trace from a pet is not.
    const out = execFileSync(python, ['-c', script, DB, sessionId], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(out.trim());
    if (parsed !== null) return parsed;
  } catch (error) {
    debug('python read failed:', String(error?.message ?? error).split('\n')[0].slice(0, 120));
  }

  try {
    // Dynamic import, so a node without node:sqlite fails here rather than failing to load the
    // file at all. Callers should pass --no-warnings; see the note above about why the script
    // cannot do it for them.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(DB, { readOnly: true });
    try {
      const row = db.prepare('select used, size, credit_json from session_usage where session_id = ?').get(sessionId);
      if (!row) return null;
      return { used: Number(row.used), size: Number(row.size), credit: sumCredits(row.credit_json) };
    } finally {
      db.close();
    }
  } catch (error) {
    debug('node:sqlite unavailable or failed:', error?.message ?? error);
    return null;
  }
}

/** credit_json is request-id -> credits for that request; null on sessions that never spent any. */
function sumCredits(raw) {
  if (!raw) return null;
  try {
    const map = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    if (!map || typeof map !== 'object') return null;
    let total = 0;
    for (const value of Object.values(map)) if (Number.isFinite(Number(value))) total += Number(value);
    return total;
  } catch {
    return null;
  }
}

/**
 * Which steps have already been spoken for this session. Without this the cat would repeat
 * itself on every single message above a threshold, which is exactly the behaviour that gets a
 * feature uninstalled.
 */
function readState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    mkdirSync(join(STATE_FILE, '..'), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, STATE_FILE);
  } catch (error) {
    debug('could not persist state:', error?.message ?? error);
  }
}

async function say(text, priority) {
  let auth = null;
  try {
    auth = readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    // No token means the app has never run. Say nothing rather than guess.
    return false;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      // Say who is speaking. Without `agent` the app files the line under "anonymous", and the
      // bubble reads as a notification from nobody.
      body: JSON.stringify({ say: text, priority, agent: process.env.LINGXI_AGENT || 'workbuddy' }),
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false; // App not running. A normal state for a desktop pet.
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf('--session');
  let sessionId = flagIndex >= 0 ? args[flagIndex + 1] : null;

  if (!sessionId) {
    const text = args.find((arg) => arg.trim().startsWith('{')) ?? (await readStdin());
    if (text.trim()) {
      try {
        sessionId = JSON.parse(text).session_id ?? null;
      } catch {
        return; // not a hook payload we understand
      }
    }
  }
  if (!sessionId || typeof sessionId !== 'string') {
    debug('no session id in the payload; nothing to look up');
    return;
  }

  const usage = await sessionUsage(sessionId);
  if (!usage || !Number.isFinite(usage.used) || !Number.isFinite(usage.size) || usage.size <= 0) {
    debug('no usage row for', sessionId);
    return;
  }

  const ratio = usage.used / usage.size;
  const percent = Math.round(ratio * 100);
  debug(`${sessionId} ${usage.used}/${usage.size} = ${percent}%` +
    (Number.isFinite(usage.credit) ? `, credit ${usage.credit.toFixed(2)}` : ', no credit row'));

  const state = readState();
  const seen = state[sessionId] ?? {};

  // Highest threshold crossed, so that jumping straight from 0.4 to 0.75 does not play the
  // 0.6 line after the fact - only what actually still applies.
  let pending = null;
  for (const tier of TIERS) if (ratio >= tier.at) pending = tier;
  if (pending && seen.tier !== pending.at) {
    const said = await say(pending.line(percent), pending.priority);
    if (said) seen.tier = pending.at;
  } else if (!pending && seen.tier !== undefined) {
    // A compact or a new context brought it back down; let it warn again next time.
    delete seen.tier;
  }

  if (CREDIT_BUDGET > 0 && Number.isFinite(usage.credit) && usage.credit >= CREDIT_BUDGET && !seen.credit) {
    const said = await say(`这个会话已经烧掉 ${Math.round(usage.credit)} credits 了。`, 'status');
    if (said) seen.credit = true;
  }

  state[sessionId] = seen;
  writeState(state);
}

main().catch((error) => debug('unexpected:', error?.message ?? error));
