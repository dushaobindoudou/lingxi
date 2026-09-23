// Fail the Rust build with something you can act on.
//
// `npm run tauri dev` shells out to cargo, so when cargo is not on PATH the whole thing ends at
// `sh: cargo: command not found` - emitted from inside the Tauri CLI, with no indication that a
// Rust toolchain is what is wanted, or that one may already be installed a directory away.
//
// That is the common case on a fresh machine rather than an exotic one: rustup installs its
// shims into ~/.cargo/bin and appends the PATH line to ONE shell profile. A different shell, a
// GUI-launched terminal, a login shell that reads .zprofile instead of .zshrc, or any editor
// spawning npm with a trimmed environment, and the shims are present on disk but absent from
// PATH. rust-toolchain.toml already documents the mirror image of this (Homebrew's cargo ahead
// of rustup's, which silently ignores the pinned channel) - both failures are PATH ordering, and
// neither says so.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Kept in step with the comment in rust-toolchain.toml - the dependency tree (tauri, image, time,
// plist, serde_with) does not resolve below this, and the failure that produces is a wall of
// "requires rustc 1.88" from deep inside the resolver rather than a version complaint.
const MIN = [1, 88];
const SHIM = join(homedir(), '.cargo', 'bin');

const die = (...lines) => { console.error(`\n  ${lines.join('\n  ')}\n`); process.exit(1); };
const run = (bin, args) => {
  try { return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};

const version = run('rustc', ['--version']);

if (version === null) {
  // On disk but not on PATH is a different problem from not installed, and telling them apart is
  // the entire value of this check: one is a one-line export, the other is a download.
  if (existsSync(join(SHIM, 'cargo'))) {
    die(
      'Rust is installed but not on PATH for this shell.',
      '',
      `rustup's shims are in ${SHIM}, which this process cannot see.`,
      'For this one command:',
      '',
      '    PATH="$HOME/.cargo/bin:$PATH" npm run tauri dev',
      '',
      'To fix it for good, add that directory to PATH in your shell profile',
      '(~/.zprofile for a macOS login shell):',
      '',
      '    echo \'export PATH="$HOME/.cargo/bin:$PATH"\' >> ~/.zprofile',
    );
  }
  die(
    'No Rust toolchain found - 灵犀 has a Rust backend (Tauri 2), so this is required.',
    '',
    '    curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh',
    '',
    'Then open a new shell, or run: source "$HOME/.cargo/env"',
    'rust-toolchain.toml pins the channel, so rustup takes it from there.',
  );
}

const found = version.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
if (found) {
  const [major, minor] = [Number(found[1]), Number(found[2])];
  if (major < MIN[0] || (major === MIN[0] && minor < MIN[1])) {
    // The Homebrew case from rust-toolchain.toml: a real rustc answers, so nothing looks broken
    // until the resolver rejects half the dependency tree.
    const which = run('sh', ['-c', 'command -v rustc']) ?? 'rustc';
    die(
      `Rust ${major}.${minor} is too old - the dependency tree needs ${MIN.join('.')}+.`,
      '',
      `The rustc in front is: ${which}`,
      ...(which.startsWith(SHIM) ? [
        '',
        'That is rustup\'s shim, so update the toolchain:',
        '',
        '    rustup update stable',
      ] : [
        '',
        `That is NOT rustup's shim (${SHIM}), so rust-toolchain.toml's pinned`,
        'channel is being ignored - see the note at the top of that file. Put rustup first:',
        '',
        '    PATH="$HOME/.cargo/bin:$PATH" npm run tauri dev',
      ]),
    );
  }
}
