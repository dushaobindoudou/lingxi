// Start the app if it is not running, so an agent's first call is not "the cat is not reachable".
//
// The bridge only exists while the app does. Every integration - the CLI, this MCP server, the
// DSH plugin, a bare curl - talks to a port that a GUI application happens to be holding open,
// and that application is the one thing none of them could start. So the whole chain worked
// perfectly right up to the point where the user had not opened the cat yet, and then reported
// "灵犀 is not reachable", which is true and useless: the caller is a model, and the person who
// could open the app is not necessarily looking at the terminal.
//
// What this does NOT do is install anything. If the app is not on the machine there is nothing
// to launch and it says so, with where to get one. Launching is also opt-out (LINGXI_AUTOSTART=0)
// because a tool call that makes a window appear on someone's desktop should be refusable - the
// person may be screen-sharing, presenting, or simply not want the cat right now.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const BUNDLE_ID = 'com.dushaobin.lingxi-desktop';
export const APP_NAME = '灵犀';

/** Where a built app normally sits. Checked only to produce a better message than `open` does. */
const LIKELY_PATHS = [
  `/Applications/${APP_NAME}.app`,
  join(homedir(), 'Applications', `${APP_NAME}.app`),
  '/Applications/lingxi.app',
];

/** How long to wait for the bridge after asking the app to start. */
const BOOT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 300;

/**
 * Why a launch could not even be attempted, or null if one can be.
 *
 * Kept separate from "the launch failed" because the two need different answers: a missing app
 * is something the user has to fix once, a failed launch is something to retry or report.
 */
export function launchBlockedReason() {
  if (process.env.LINGXI_AUTOSTART === '0' || process.env.LINGXI_AUTOSTART === 'false') {
    return `${APP_NAME} is not running, and LINGXI_AUTOSTART=0 asked me not to start it. Open it yourself, or unset that variable.`;
  }
  if (platform() !== 'darwin') {
    return `${APP_NAME} is not running. This build only knows how to start it on macOS - start it yourself and try again.`;
  }
  if (!installedPath()) {
    return (
      `${APP_NAME} does not appear to be installed - nothing to start. Build it with ` +
      '`npm run tauri build` in apps/lingxi, or drag the .app into /Applications.'
    );
  }
  return null;
}

/**
 * The installed app's path, or null.
 *
 * `mdfind` by bundle identifier first, because that finds it wherever the user actually put it,
 * and Spotlight is the same index `open -b` consults - so agreeing with it is the point. It can
 * be disabled or still indexing on a fresh copy, hence the fallback list of the usual places.
 */
export function installedPath() {
  try {
    const found = execFileSync(
      'mdfind',
      [`kMDItemCFBundleIdentifier == '${BUNDLE_ID}'`],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (found.length) return found[0];
  } catch {
    // mdfind missing, disabled, or slow - fall through to the known locations.
  }
  return LIKELY_PATHS.find((path) => existsSync(path)) ?? null;
}

/** Ask the app to open, without waiting for it and without stealing focus. */
function spawnApp() {
  return new Promise((resolve) => {
    // `-g` keeps the cat from jumping in front of whatever the user is doing. `-j` would also
    // hide it, but the whole point is that it becomes visible on the desktop.
    execFile('open', ['-g', '-b', BUNDLE_ID], { timeout: 5000 }, (error) => {
      if (!error) return resolve(null);
      const path = installedPath();
      if (!path) return resolve(error.message);
      // Bundle id lookup can fail on a copy Launch Services has not registered yet (a fresh
      // build that has never been opened by hand). The path always works.
      execFile('open', ['-g', path], { timeout: 5000 }, (pathError) =>
        resolve(pathError ? pathError.message : null),
      );
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Make sure the bridge is up, starting the app if it is not, and answer what happened.
 *
 * `isUp` is injected rather than imported so this module never has to know how a caller checks
 * (the MCP server has a fetch wrapper with token handling; a test has neither).
 *
 * Returns { ok, started, reason } - `started` true only when this call is what brought it up,
 * so a caller can mention it once instead of on every subsequent request.
 */
export async function ensureRunning(isUp, { timeoutMs = BOOT_TIMEOUT_MS } = {}) {
  if (await isUp()) return { ok: true, started: false, reason: null };

  const blocked = launchBlockedReason();
  if (blocked) return { ok: false, started: false, reason: blocked };

  const failure = await spawnApp();
  if (failure) {
    return { ok: false, started: false, reason: `could not start ${APP_NAME}: ${failure}` };
  }

  // A Tauri app has to launch, create its windows and bind the port. Polling rather than a flat
  // sleep so the common case (already warm in the launch cache) costs a few hundred milliseconds
  // rather than the whole budget.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (await isUp()) return { ok: true, started: true, reason: null };
  }
  return {
    ok: false,
    started: false,
    reason:
      `${APP_NAME} was asked to start but its bridge did not come up within ` +
      `${Math.round(timeoutMs / 1000)}s. It may be waiting on a permission prompt, or another ` +
      'process may be holding port 47811 - check with: lsof -nP -iTCP:47811 -sTCP:LISTEN',
  };
}
