#!/usr/bin/env node
// macOS native regression: read NSStatusItem's actual title after 1 -> 0 -> 2 -> 0.
// Run `cargo test` in apps/lingxi/src-tauri first to provide the pinned debug dependencies.
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('This probe needs macOS and a logged-in desktop session.');
  process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const deps = join(root, 'apps/lingxi/src-tauri/target/debug/deps');
const crates = ['tray_icon', 'objc2_app_kit', 'objc2_foundation'];
const externs = crates.flatMap((name) => {
  const candidates = existsSync(deps) ? readdirSync(deps)
    .filter((file) => file.startsWith(`lib${name}-`) && file.endsWith('.rlib'))
    .map((file) => join(deps, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs) : [];
  if (!candidates.length) throw new Error(`Missing ${name}: run cargo test in apps/lingxi/src-tauri first.`);
  return ['--extern', `${name}=${candidates[0]}`];
});
const work = mkdtempSync(join(tmpdir(), 'lingxi-tray-badge-'));
try {
  const source = join(work, 'probe.rs');
  const binary = join(work, 'probe');
  writeFileSync(source, `
#[path = ${JSON.stringify(join(root, 'apps/lingxi/src-tauri/src/tray_badge.rs'))}]
mod tray_badge;
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
use objc2_foundation::MainThreadMarker;
fn main() {
    let mtm = MainThreadMarker::new().expect("probe runs on the main thread");
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    let tray = tray_icon::TrayIconBuilder::new()
        .with_tooltip("灵犀未读数字检查（临时）")
        .build().expect("create a temporary native tray item");
    for count in [1, 0, 2, 0] {
        tray.set_title(tray_badge::attention_title(count));
        let title = tray.ns_status_item().unwrap().button(mtm).unwrap().title().to_string();
        let expected = if count == 0 { String::new() } else { count.to_string() };
        println!("unread={count}, native title={title:?}");
        assert_eq!(title, expected, "zero unread must clear the actual macOS title");
    }
}
`);
  const shim = join(homedir(), '.cargo/bin/rustc');
  const rustc = existsSync(shim) ? shim : 'rustc';
  for (const [command, args] of [
    [rustc, [source, '--edition=2021', '-L', `dependency=${deps}`, ...externs, '-o', binary]],
    [binary, []],
  ]) {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      break;
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
