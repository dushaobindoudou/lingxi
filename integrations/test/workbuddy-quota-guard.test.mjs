// lingxi-quota-guard: the part of the WorkBuddy integration that reads the host's private
// usage database.
//
// This is the one lingxi file that depends on an unpublished schema (`~/.workbuddy/workbuddy.db`,
// table `session_usage`). It is allowed to stop working - WorkBuddy can change that table any
// release - but it must stop *quietly*, and while it does work it must not repeat itself. Both
// of those are easy to regress and neither shows up in normal use, so they are asserted here.
//
// The bridge is a local HTTP server on an ephemeral port, so nothing reaches the real cat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const GUARD = join(REPO, 'integrations/hosts/workbuddy/bin/lingxi-quota-guard.mjs');
const PYTHON = process.execPath;

/** A session_usage fixture. used/size is the context window; credit_json is request-id -> cost. */
function fixtureDb(dir, rows) {
  const db = join(dir, 'workbuddy.db');
  const script = [
    'import sqlite3,json,sys',
    'c=sqlite3.connect(sys.argv[1])',
    'c.execute("create table session_usage(session_id text primary key, used integer, size integer, updated_at integer, credit_json text)")',
    'for sid,used,size,cj in json.loads(sys.argv[2]):',
    '    c.execute("insert into session_usage values(?,?,?,?,?)",(sid,used,size,1700000000000,cj))',
    'c.commit()',
  ].join('\n');
  const r = spawnSync('python3', ['-c', script, db, JSON.stringify(rows)], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture failed: ${r.stderr}`);
  return db;
}

/**
 * Run the guard with a fake bridge. Returns { said: [{text, priority}], code, stderr }.
 * The fake bridge answers 200 and records everything the cat would have said.
 */
// --no-warnings is what the installer actually ships, so it is the default here. One test
// deliberately drops it to prove the script does not *need* it on the path that matters.
async function runGuard({ db, session, env = {}, stdin = '', nodeFlags = ['--no-warnings'] }) {
  const said = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (body.trim()) {
        try { said.push(JSON.parse(body)); } catch { /* not our payload */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const dir = mkdtempSync(join(tmpdir(), 'lingxi-qg-'));
  const tokenFile = join(dir, 'bridge-token');
  writeFileSync(tokenFile, 'test-token');
  try {
    // spawn, not spawnSync: the fake bridge lives in this process's event loop, and a
    // synchronous child would block it - every request would then hit the guard's 1500ms
    // timeout and the test would "prove" the guard never speaks.
    const child = spawn(PYTHON, [...nodeFlags, GUARD, ...(session ? ['--session', session] : [])], {
      env: {
        ...process.env,
        LINGXI_WB_DB: db,
        LINGXI_PORT: String(port),
        LINGXI_TOKEN_FILE: tokenFile,
        LINGXI_QUOTA_STATE: join(dir, 'state.json'),
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.stdin.end(stdin ?? '');
    const code = await new Promise((resolve) => child.on('close', resolve));
    return { said, code, stderr: err, out };
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const ROWS = [
  ['s-low', 50000, 300000, null],
  ['s-warn', 200000, 300000, null],   // 67%
  ['s-crit', 220000, 300000, null],   // 73%
  ['s-emer', 280000, 300000, null],   // 93%
  ['s-credit', 50000, 300000, JSON.stringify({ a: 120.5, b: 79.5 })], // 200 total, 17% context
];

test('it says nothing while there is room, and speaks once per threshold', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-qg-fixture-'));
  try {
    const db = fixtureDb(dir, ROWS);

    const quiet = await runGuard({ db, session: 's-low' });
    assert.equal(quiet.code, 0, 'a quiet run must still exit 0');
    assert.deepEqual(quiet.said, [], '17% is nowhere near a threshold');

    const warn = await runGuard({ db, session: 's-warn' });
    assert.equal(warn.said.length, 1, 'one line per crossing, not one per tier below it');
    assert.match(warn.said[0].say, /67%/, 'the line should carry the real percentage');
    assert.equal(warn.said[0].agent, 'workbuddy', 'an unattributed line shows up as an anonymous bubble');
    assert.equal(warn.said[0].priority, 'status');

    const crit = await runGuard({ db, session: 's-crit' });
    assert.equal(crit.said.length, 1);
    assert.match(crit.said[0].say, /73%/);
    assert.equal(crit.said[0].priority, 'report', 'a near-full window outranks a status line');

    const emer = await runGuard({ db, session: 's-emer' });
    assert.equal(emer.said.length, 1);
    assert.match(emer.said[0].say, /93%/);
    // Deliberately not `alert`: a pet that outranks the agent's own report gets uninstalled.
    assert.equal(emer.said[0].priority, 'report');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The failure this exists to prevent: without the state file the cat repeats the same line on
// every single message above 60%, which is how a feature gets turned off.
test('it does not repeat itself - the same threshold is said once per session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-qg-fixture-'));
  const state = join(dir, 'state.json');
  try {
    const db = fixtureDb(dir, ROWS);
    const first = await runGuard({ db, session: 's-warn', env: { LINGXI_QUOTA_STATE: state } });
    assert.equal(first.said.length, 1);

    const second = await runGuard({ db, session: 's-warn', env: { LINGXI_QUOTA_STATE: state } });
    assert.deepEqual(second.said, [], 'the 67% line was already said for this session');

    // A different session is a different conversation and gets its own warning.
    const other = await runGuard({ db, session: 's-crit', env: { LINGXI_QUOTA_STATE: state } });
    assert.equal(other.said.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the credit budget is opt-in and fires once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-qg-fixture-'));
  const state = join(dir, 'state.json');
  try {
    const db = fixtureDb(dir, ROWS);

    const off = await runGuard({
      db, session: 's-credit', env: { LINGXI_QUOTA_STATE: state },
    });
    assert.deepEqual(off.said, [], 'no budget means no credit line');

    // 200 spent, budget 150 -> speaks. Note the context window is only 17% here, so this is the
    // credit line and nothing else.
    const over = await runGuard({
      db, session: 's-credit', env: { LINGXI_QUOTA_STATE: state, LINGXI_QUOTA_CREDIT_BUDGET: '150' },
    });
    assert.equal(over.said.length, 1);
    assert.match(over.said[0].say, /200 credits/);

    const again = await runGuard({
      db, session: 's-credit', env: { LINGXI_QUOTA_STATE: state, LINGXI_QUOTA_CREDIT_BUDGET: '150' },
    });
    assert.deepEqual(again.said, [], 'the credit line is said once, like every other line');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LINGXI_QUOTA_STEPS moves the thresholds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-qg-fixture-'));
  try {
    const db = fixtureDb(dir, ROWS);
    // s-low is 17% - silent by default, but loud if you ask to be told at 10%.
    const r = await runGuard({
      db, session: 's-low', env: { LINGXI_QUOTA_STEPS: '0.05,0.10,0.15' },
    });
    assert.equal(r.said.length, 1, 'a custom step ladder should be honoured');
    assert.match(r.said[0].say, /17%/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// WorkBuddy owns that database. If a release renames the table, this integration must become a
// no-op rather than an error in someone's agent output.
test('every failure is silent, exits 0, and says nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-qg-fixture-'));
  try {
    const db = fixtureDb(dir, ROWS);

    const noDb = await runGuard({ db: join(dir, 'nope.db'), session: 's-warn' });
    assert.equal(noDb.code, 0);
    assert.deepEqual(noDb.said, []);
    assert.equal(noDb.stderr, '', `a missing database must not print: ${noDb.stderr}`);

    const noSession = await runGuard({ db, session: null, stdin: '{}' });
    assert.equal(noSession.code, 0);
    assert.deepEqual(noSession.said, []);

    const garbage = await runGuard({ db, session: null, stdin: 'not json at all' });
    assert.equal(garbage.code, 0);
    assert.deepEqual(garbage.said, []);
    assert.equal(garbage.stderr, '', `bad stdin must not print: ${garbage.stderr}`);

    const unknown = await runGuard({ db, session: 's-does-not-exist' });
    assert.equal(unknown.code, 0);
    assert.deepEqual(unknown.said, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('it reads the session id out of a hook payload on stdin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-qg-fixture-'));
  try {
    const db = fixtureDb(dir, ROWS);
    const r = await runGuard({
      db,
      session: null,
      stdin: JSON.stringify({ hook_event_name: 'Stop', session_id: 's-emer', cwd: dir }),
    });
    assert.equal(r.said.length, 1, 'the guard must work from a real hook payload');
    assert.match(r.said[0].say, /93%/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The reason python3 goes first: node:sqlite prints `ExperimentalWarning: SQLite is an
// experimental feature` to stderr no matter what - even with a 'warning' listener installed -
// and that lands in the host's hook output. So the *default* path must never touch node:sqlite,
// and it must therefore be silent even without --no-warnings.
test('the default path reads through python and stays silent without --no-warnings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-qg-fixture-'));
  try {
    const db = fixtureDb(dir, ROWS);
    const r = await runGuard({ db, session: 's-warn', nodeFlags: [] });
    assert.equal(r.code, 0);
    assert.equal(r.said.length, 1, 'python should find the row');
    assert.match(r.said[0].say, /67%/);
    assert.equal(r.stderr, '', `the default path must be silent unaided: ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// node:sqlite is the fallback for machines without python. It gets the same answer, it just
// cannot be silent on its own - hence --no-warnings in the shipped hook command.
test('node:sqlite takes over when python is unavailable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-qg-fixture-'));
  try {
    const db = fixtureDb(dir, ROWS);
    const r = await runGuard({
      db, session: 's-warn', env: { LINGXI_PYTHON: '/bin/false' },
    });
    assert.equal(r.code, 0);
    assert.equal(r.said.length, 1, 'the node engine should still find the row');
    assert.match(r.said[0].say, /67%/);
    assert.equal(r.stderr, '', `with --no-warnings there must be no output: ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
