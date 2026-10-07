// Start the app if it is not running - and install it if it is not there - so an agent's first
// call is not "the cat is not reachable".
//
// The bridge only exists while the app does. Every integration - the CLI, this MCP server, the
// DSH plugin, a bare curl - talks to a port that a GUI application happens to be holding open,
// and that application is the one thing none of them could start. So the whole chain worked
// perfectly right up to the point where the user had not opened the cat yet, and then reported
// "灵犀 is not reachable", which is true and useless: the caller is a model, and the person who
// could open the app is not necessarily looking at the terminal.
//
// A machine without the app gets it from GitHub: the installer that ships beside this server
// (../scripts/install-app.sh, the same file every host plugin carries) downloads the latest
// release, checks its SHA256, bundle id and signature, installs it and opens it. That runs
// detached - a download must not hold a tool call, and it should finish even if the host closes
// this server - so the call that started it answers "being installed, try again shortly".
// Launching is opt-out (LINGXI_AUTOSTART=0) because a tool call that makes a window appear on
// someone's desktop should be refusable; installing has its own opt-out, LINGXI_AUTOINSTALL=0.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLE_ID = 'com.dushaobin.lingxi-desktop';
export const APP_NAME = '灵犀';
export const RELEASES_URL = 'https://github.com/dushaobindoudou/lingxi/releases';

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
      `${APP_NAME} does not appear to be installed - nothing to start. Download it from ` +
      `${RELEASES_URL} and drag it into /Applications, or unset LINGXI_AUTOINSTALL=0 so this ` +
      'server can install it.'
    );
  }
  return null;
}

const falsy = (value) => ['0', 'false', 'no', 'off'].includes(String(value ?? '').trim().toLowerCase());

/** The installer that ships beside this server, or null in a copy that has none. */
export function installerPath() {
  const path = process.env.LINGXI_INSTALLER || fileURLToPath(new URL('../scripts/install-app.sh', import.meta.url));
  return existsSync(path) ? path : null;
}

/** Why the app cannot be installed from here, or null if it can. */
export function installBlockedReason() {
  if (falsy(process.env.LINGXI_AUTOSTART)) return 'LINGXI_AUTOSTART=0';
  if (falsy(process.env.LINGXI_AUTOINSTALL)) return 'LINGXI_AUTOINSTALL=0';
  if (platform() !== 'darwin') return 'not macOS';
  if (!installerPath()) return 'no installer beside this server';
  return null;
}

/** The machine-wide lock install-app.sh holds while it works (integrations/shared/lib.sh). */
function installInProgress() {
  const lock = process.env.LINGXI_INSTALL_LOCK || join(homedir(), '.lingxi', 'install.lock');
  try {
    return Date.now() - statSync(lock).mtimeMs < 15 * 60_000;
  } catch {
    return false;
  }
}

/**
 * Begin installing the app from GitHub, detached, and say so. The installer opens the app when
 * it is done, so the next call after that simply finds it running.
 */
function startInstall() {
  const busy = `${APP_NAME} is being installed from GitHub right now (about 16 MB); it opens by itself ` +
    'when it is done. Try again in a minute - or tell the user the cat is on its way.';
  if (installInProgress()) return busy;
  const host = process.env.LINGXI_HOST || process.env.LINGXI_AGENT || 'mcp';
  const child = spawn('bash', [installerPath(), '--open'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, LINGXI_HOST: host.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'mcp' },
  });
  child.on('error', () => {});
  child.unref();
  return `${APP_NAME} was not installed, so I started installing it from GitHub (about 16 MB). ` +
    'It opens by itself in a minute or so; try again then.';
}

/**
 * The installed app's path, or null.
 *
 * `mdfind` by bundle identifier first, because that finds it wherever the user actually put it,
 * and Spotlight is the same index `open -b` consults - so agreeing with it is the point. It can
 * be disabled or still indexing on a fresh copy, hence the fallback list of the usual places.
 */
export function installedPath() {
  // Same override as integrations/shared/lib.sh: an exact path, honoured even when it is missing.
  if (process.env.LINGXI_APP_PATH) return existsSync(process.env.LINGXI_APP_PATH) ? process.env.LINGXI_APP_PATH : null;
  const usual = LIKELY_PATHS.find((path) => existsSync(path));
  if (usual) return usual;
  try {
    const found = execFileSync(
      'mdfind',
      [`kMDItemCFBundleIdentifier == '${BUNDLE_ID}'`],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .split('\n')
      .map((line) => line.trim())
      // Never a build output, a mounted image or the Trash - starting the copy in
      // src-tauri/target/…/bundle instead of the installed app is what this used to do.
      .filter((line) => line && !/^\/Volumes\/|\/target\/|\/\.Trash\/|\/node_modules\//.test(line));
    if (found.length) return found[0];
  } catch {
    // mdfind missing, disabled, or slow - fall through to the known locations.
  }
  return null;
}

/** Ask the app to open, without waiting for it and without stealing focus. */
function spawnApp() {
  return new Promise((resolve) => {
    // `-g` keeps the cat from jumping in front of whatever the user is doing. `-j` would also
    // hide it, but the whole point is that it becomes visible on the desktop.
    // By path first: `open -b` lets Launch Services choose among every copy it has ever seen,
    // build outputs included. The bundle id is the fallback for a copy found nowhere else.
    const path = installedPath();
    const byId = () => execFile('open', ['-g', '-b', BUNDLE_ID], { timeout: 5000 }, (error) =>
      resolve(error ? error.message : null));
    if (!path) return byId();
    execFile('open', ['-g', path], { timeout: 5000 }, (error) => (error ? byId() : resolve(null)));
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
 * so a caller can mention it once instead of on every subsequent request - plus `installing`
 * when the app was missing and a download from GitHub has been started instead.
 */
export async function ensureRunning(isUp, { timeoutMs = BOOT_TIMEOUT_MS } = {}) {
  if (await isUp()) return { ok: true, started: false, reason: null };

  // Not installed at all: install it (detached) rather than report that there is nothing to start.
  if (!installBlockedReason() && !installedPath()) {
    return { ok: false, started: false, installing: true, reason: startInstall() };
  }

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
