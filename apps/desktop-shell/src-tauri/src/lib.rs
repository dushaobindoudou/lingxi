// Desktop Shell backend (see docs/05-technical-architecture.md module boundaries).
//
// Responsibilities kept here, and only here:
// - own the OS window (position it over the full monitor work area, transparent, borderless)
// - poll the OS-level cursor position, since a click-through window stops receiving DOM
//   mouse events entirely and the companion still needs to know where the cursor is
// - expose click-through toggling to the frontend (native Tauri API, no custom command needed)
// - own the tray icon/menu (size presets, show/hide, management window, quit) - this is the
//   app's primary control surface; the app additionally shows a Dock icon (Regular
//   activation policy, user request 2026-09-12) whose click reopens a hidden pet
//   (RunEvent::Reopen below)
// - keep the tray's checkable size items and the management window's own controls in sync,
//   since both can change the same state (see TrayState)
//
// Everything else - behavior, animation, rendering - lives in the frontend packages and
// talks to this shell only through the events/commands declared here.

use objc2::rc::autoreleasepool;
use objc2_app_kit::NSEvent;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Read-only trust check: NEVER shows the system permission dialog, safe to call as often as
/// wanted (every `get_status` poll, i.e. every management-window open and every companion
/// startup). Use this, never `accessibility_permission_ready` below, for anything but a
/// genuine one-time startup check - see that function's doc comment for why conflating the
/// two re-prompts the user on every single poll.
#[cfg(target_os = "macos")]
fn accessibility_trusted_readonly() -> bool {
    macos_accessibility_client::accessibility::application_is_trusted()
}

#[cfg(not(target_os = "macos"))]
fn accessibility_trusted_readonly() -> bool {
    true
}

/// Checks (and, if not yet granted, prompts for) macOS Accessibility permission. Call this
/// only from a genuine one-time startup path (see setup() below) - NEVER from a
/// repeatedly-invoked status check like `get_status`, which must use
/// `accessibility_trusted_readonly` instead. `get_status` used to call this directly, which
/// re-triggers the system prompt on *every* call whenever `application_is_trusted()` doesn't
/// stick between builds (observed in practice with locally-rebuilt/ad-hoc-signed debug
/// bundles - TCC can treat each rebuild as a "new" app even though the user already granted
/// it once) - every management-window open and every companion startup asks again despite
/// the user having already said yes (reported as "每次打开主界面都会弹窗授权，我的授权已经
/// 授权了").
/// Cursor position no longer needs this (see poll_global_cursor below) - kept only
/// for the future global click/keystroke *listener*, which is a materially different,
/// still-permission-gated ask (see docs/16-desktop-shell-prototype.md).
#[cfg(target_os = "macos")]
fn accessibility_permission_ready() -> bool {
    if accessibility_trusted_readonly() {
        return true;
    }
    macos_accessibility_client::accessibility::application_is_trusted_with_prompt()
}

#[cfg(not(target_os = "macos"))]
fn accessibility_permission_ready() -> bool {
    true
}

#[derive(Clone, Serialize)]
struct CursorPayload {
    x: i32,
    y: i32,
}

#[derive(Clone, Serialize)]
struct MonitorPayload {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

const SCALE_SMALL: f64 = 0.25;
const SCALE_MEDIUM: f64 = 0.5;
const SCALE_LARGE: f64 = 1.0;

const MODE_AUTO: &str = "auto";
const MODE_PLAY: &str = "play";

/// The AI coding agents this build knows how to name/select in the "Agent 接入" page.
/// "none" means no agent is treated as actively connected. This is a *label* today - see
/// the doc comment on `set_active_agent` for what it does and, honestly, doesn't yet do.
const KNOWN_AGENTS: [&str; 4] = ["none", "dsh", "codex", "claude"];
const DEFAULT_CAT_NAME: &str = "灵犀";

/// "性格行为" behavior presets, per docs/18-main-interface-design.md §5.4: a packaged
/// stand-in for avoidRadius (and, later, wander speed/rate) until per-trait tuning exists.
/// Values are the doc's own numbers - "安静档 avoidRadius≈猫身+40px，均衡 100px，活泼
/// 150px" - "活泼" kept equal to life-engine's pre-existing DEFAULTS.avoidRadius (150) so
/// picking it, or never opening this page at all, changes nothing about today's behavior.
const KNOWN_BEHAVIOR_PRESETS: [&str; 3] = ["quiet", "balanced", "lively"];
const DEFAULT_BEHAVIOR_PRESET: &str = "lively";

fn avoid_radius_for_preset(preset: &str) -> f64 {
    match preset {
        "quiet" => 70.0,
        "balanced" => 100.0,
        _ => 150.0, // "lively", and the fallback for anything unrecognized
    }
}

/// docs/18 §5.4's five personality sliders - same field names as
/// `packages/contracts/src/index.d.ts`'s `PersonalityManifest.traits`, so a future JS-side
/// consumer (the behavior engine, an AI driver reading GET /perception) can deserialize this
/// straight into that shape without a translation layer. Every trait is 0..1; unlike
/// avoidRadius above, nothing in the behavior engine reads these yet (see the "即将生效"
/// hint doc/18 requires next to any trait not yet consumed) - they persist and broadcast
/// today, honestly inert otherwise.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
struct PersonalityTraits {
    independence: f64,
    curiosity: f64,
    gentleness: f64,
    playfulness: f64,
    sleepiness: f64,
}

impl PersonalityTraits {
    fn defaults() -> Self {
        // Midpoint on every trait: no claim about the cat's "real" personality until the
        // user actually moves a slider.
        Self { independence: 0.5, curiosity: 0.5, gentleness: 0.5, playfulness: 0.5, sleepiness: 0.5 }
    }

    fn clamped(self) -> Self {
        fn c(v: f64) -> f64 {
            if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.5 }
        }
        Self {
            independence: c(self.independence),
            curiosity: c(self.curiosity),
            gentleness: c(self.gentleness),
            playfulness: c(self.playfulness),
            sleepiness: c(self.sleepiness),
        }
    }
}


/// Tray/settings-window state persisted under the app config dir, so the user's
/// chosen size, visibility, interaction mode, cat identity and agent selection survive
/// an app restart. Written on every change (a tiny JSON file) and loaded once during
/// setup, before any window or webview can observe the wrong default.
///
/// `#[serde(default)]` on the newer fields means an older settings.json (written before
/// they existed) still deserializes cleanly instead of failing closed to full defaults -
/// only the missing fields fall back, everything already saved is kept.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct PersistedSettings {
    version: u32,
    scale: f64,
    visible: bool,
    mode: String,
    #[serde(default = "default_cat_name")]
    cat_name: String,
    #[serde(default)]
    cat_personality: String,
    #[serde(default = "default_active_agent")]
    active_agent: String,
    #[serde(default = "PersonalityTraits::defaults")]
    personality_traits: PersonalityTraits,
    #[serde(default = "default_behavior_preset")]
    behavior_preset: String,
}

fn default_cat_name() -> String {
    DEFAULT_CAT_NAME.to_string()
}

fn default_active_agent() -> String {
    "none".to_string()
}

fn default_behavior_preset() -> String {
    DEFAULT_BEHAVIOR_PRESET.to_string()
}

impl PersistedSettings {
    fn defaults() -> Self {
        Self {
            version: 1,
            scale: SCALE_LARGE,
            visible: true,
            mode: MODE_AUTO.to_string(),
            cat_name: default_cat_name(),
            cat_personality: String::new(),
            active_agent: default_active_agent(),
            personality_traits: PersonalityTraits::defaults(),
            behavior_preset: default_behavior_preset(),
        }
    }
}

/// Only accept settings this app actually wrote: the scale must be one of the three
/// tray presets (all exactly representable in f64, so equality is safe), the mode and
/// agent must be known values, and the name is trimmed/length-capped. A hand-edited or
/// corrupt file falls back to defaults per-field instead of producing a cat sized 0,
/// a nonsense mode, or a wall-of-text name in a UI built for a short one.
fn sanitize_settings(settings: PersistedSettings) -> PersistedSettings {
    let known_scale = [SCALE_SMALL, SCALE_MEDIUM, SCALE_LARGE]
        .iter()
        .any(|preset| (*preset - settings.scale).abs() < f64::EPSILON);
    let name = settings.cat_name.trim();
    let name = if name.is_empty() { DEFAULT_CAT_NAME.to_string() } else { name.chars().take(24).collect() };
    let personality: String = settings.cat_personality.trim().chars().take(120).collect();
    let agent = if KNOWN_AGENTS.contains(&settings.active_agent.as_str()) {
        settings.active_agent
    } else {
        default_active_agent()
    };
    let behavior_preset = if KNOWN_BEHAVIOR_PRESETS.contains(&settings.behavior_preset.as_str()) {
        settings.behavior_preset
    } else {
        default_behavior_preset()
    };
    PersistedSettings {
        version: 1,
        scale: if known_scale { settings.scale } else { SCALE_LARGE },
        visible: settings.visible,
        mode: if settings.mode == MODE_PLAY { MODE_PLAY.to_string() } else { MODE_AUTO.to_string() },
        cat_name: name,
        cat_personality: personality,
        active_agent: agent,
        personality_traits: settings.personality_traits.clamped(),
        behavior_preset,
    }
}

fn load_persisted_settings(path: Option<&PathBuf>) -> PersistedSettings {
    path.and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|body| serde_json::from_str::<PersistedSettings>(&body).ok())
        .map(sanitize_settings)
        .unwrap_or_else(PersistedSettings::defaults)
}

/// Shared handles so both the tray menu and the management window's own UI can drive (and
/// stay in sync with) the same "current scale" / "companion visible" / "interaction mode"
/// state. Menu item types in tauri::menu are cheap Clone handles around the real native
/// object, so storing clones here and in the tray's own closure is intentional, not a
/// duplication bug.
struct TrayState {
    size_small: CheckMenuItem<tauri::Wry>,
    size_medium: CheckMenuItem<tauri::Wry>,
    size_large: CheckMenuItem<tauri::Wry>,
    play_mode: CheckMenuItem<tauri::Wry>,
    work_mode: CheckMenuItem<tauri::Wry>,
    toggle_visibility: MenuItem<tauri::Wry>,
    visible: AtomicBool,
    current_scale: Mutex<f64>,
    interaction_mode: Mutex<String>,
    cat_name: Mutex<String>,
    cat_personality: Mutex<String>,
    active_agent: Mutex<String>,
    personality_traits: Mutex<PersonalityTraits>,
    behavior_preset: Mutex<String>,
    /// Where PersistedSettings is written; None only if the OS config dir is
    /// unavailable, in which case settings simply don't persist (app still works).
    settings_path: Option<PathBuf>,
}

impl TrayState {
    fn apply_scale(&self, app: &tauri::AppHandle, scale: f64) {
        let _ = self.size_small.set_checked(scale == SCALE_SMALL);
        let _ = self.size_medium.set_checked(scale == SCALE_MEDIUM);
        let _ = self.size_large.set_checked(scale == SCALE_LARGE);
        *self.current_scale.lock().unwrap() = scale;
        let _ = app.emit("set-scale", scale);
        self.persist();
    }

    fn set_visible(&self, app: &tauri::AppHandle, next_visible: bool) {
        self.visible.store(next_visible, Ordering::SeqCst);
        if let Some(window) = app.get_webview_window("companion") {
            if next_visible {
                let _ = window.show();
            } else {
                let _ = window.hide();
            }
        }
        let _ = self.toggle_visibility.set_text(if next_visible { "隐藏" } else { "显示" });
        let _ = app.emit("companion-visibility", next_visible);
        self.persist();
    }

    /// "auto" (工作模式, default: stays out of the way) or "play" (逗猫模式: actively
    /// follows the cursor) - see packages/life-engine's INTERACTION_MODES. Driven by the
    /// tray submenu, the management window, or a future AI driver (AIIntent.mode over the
    /// HTTP bridge). Two mutually-exclusive named checkmarks read more clearly at a glance
    /// than one checkbox whose label has to be mentally inverted.
    fn apply_mode(&self, app: &tauri::AppHandle, mode: &str) {
        let mode = if mode == MODE_PLAY { MODE_PLAY } else { MODE_AUTO };
        let _ = self.play_mode.set_checked(mode == MODE_PLAY);
        let _ = self.work_mode.set_checked(mode == MODE_AUTO);
        *self.interaction_mode.lock().unwrap() = mode.to_string();
        let _ = app.emit("set-interaction-mode", mode);
        self.persist();
    }

    /// "首页" page: the cat's own name/personality. Purely descriptive today - not yet
    /// wired into rendering or behavior - but persisted and broadcast so the management
    /// window's identity page and any future AI driver (via GET /perception) can read it.
    fn apply_identity(&self, app: &tauri::AppHandle, name: &str, personality: &str) {
        let name = name.trim();
        let name = if name.is_empty() { DEFAULT_CAT_NAME.to_string() } else { name.chars().take(24).collect() };
        let personality: String = personality.trim().chars().take(120).collect();
        *self.cat_name.lock().unwrap() = name.clone();
        *self.cat_personality.lock().unwrap() = personality.clone();
        let _ = app.emit("set-cat-identity", serde_json::json!({ "name": name, "personality": personality }));
        self.persist();
    }

    /// "Agent 接入" page: which AI coding agent is treated as "connected" today. This is
    /// currently a label plus a persisted preference - it does not itself change what the
    /// HTTP bridge (GET /perception, POST /intent - see spawn_perception_server) accepts,
    /// because that bridge is deliberately agent-agnostic: any of dsh/codex/claude (or
    /// anything else that can speak HTTP) can already poll perception and post intents
    /// today, regardless of this setting. What this DOES do: tells the management UI (and,
    /// via GET /perception's `activeAgent` field, an external driver) which agent the user
    /// considers to be "the one currently driving the pet", so multiple agents sharing the
    /// same bridge don't have to guess whether they're the intended driver. Deeper
    /// per-agent wiring (distinct auth, distinct capabilities) is future work.
    fn apply_active_agent(&self, app: &tauri::AppHandle, agent: &str) {
        let agent = if KNOWN_AGENTS.contains(&agent) { agent } else { "none" };
        *self.active_agent.lock().unwrap() = agent.to_string();
        let _ = app.emit("set-active-agent", agent);
        self.persist();
    }

    /// "性格行为" trait sliders. See `PersonalityTraits`'s doc comment: persisted and
    /// broadcast, not yet consumed by any behavior - the management window is responsible
    /// for labeling that honestly, this just stores what the user set.
    fn apply_personality_traits(&self, app: &tauri::AppHandle, traits: PersonalityTraits) {
        let traits = traits.clamped();
        *self.personality_traits.lock().unwrap() = traits.clone();
        let _ = app.emit("set-personality-traits", &traits);
        self.persist();
    }

    /// "性格行为" behavior preset (安静/均衡/活泼): the one trait-adjacent control that
    /// *does* change live behavior today, by retargeting LifeEngine's avoidRadius in the
    /// companion window (see life-engine's `setAvoidRadius` and main.ts's
    /// `set-behavior-preset` listener) - see `avoid_radius_for_preset` above for why this
    /// exists (docs/18 flags the previous fixed 150px as a real, shipped bug: "avoidRadius
    /// 150px 太大").
    fn apply_behavior_preset(&self, app: &tauri::AppHandle, preset: &str) {
        let preset = if KNOWN_BEHAVIOR_PRESETS.contains(&preset) { preset } else { DEFAULT_BEHAVIOR_PRESET };
        *self.behavior_preset.lock().unwrap() = preset.to_string();
        let _ = app.emit("set-behavior-preset", serde_json::json!({
            "preset": preset,
            "avoidRadius": avoid_radius_for_preset(preset),
        }));
        self.persist();
    }

    /// Snapshot the current state to disk. tmp-file + rename so a crash mid-write
    /// can never leave a half-written settings.json behind.
    fn persist(&self) {
        let Some(path) = &self.settings_path else { return };
        let settings = PersistedSettings {
            version: 1,
            scale: *self.current_scale.lock().unwrap(),
            visible: self.visible.load(Ordering::SeqCst),
            mode: self.interaction_mode.lock().unwrap().clone(),
            cat_name: self.cat_name.lock().unwrap().clone(),
            cat_personality: self.cat_personality.lock().unwrap().clone(),
            active_agent: self.active_agent.lock().unwrap().clone(),
            personality_traits: self.personality_traits.lock().unwrap().clone(),
            behavior_preset: self.behavior_preset.lock().unwrap().clone(),
        };
        let Ok(body) = serde_json::to_string_pretty(&settings) else { return };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, body).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

// Temporary bridge so frontend checkpoints show up in the same terminal as the
// Rust logs while debugging the transparent-window pipeline. Remove once the
// app has a real diagnostics/telemetry story.
#[tauri::command]
fn debug_log(message: String) {
    eprintln!("[frontend] {message}");
}

#[tauri::command]
fn primary_monitor_bounds(window: tauri::Window) -> Result<MonitorPayload, String> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no primary monitor reported by the OS".to_string())?;
    // The *visible* work area, not the full physical panel: excludes the menu bar and Dock
    // (whichever edge either is on). Using the full panel here meant the character's
    // "reach the edge of the screen" logic (life-engine's `bounds`) included a strip of
    // desktop that the window is never actually drawn over - the menu bar always wins that
    // layer fight, and the Dock almost always does too - so the cat could compute a
    // perfectly correct logical position "at the edge" that was actually hidden or, worse,
    // past where the window itself is positioned/sized (reported as "现在直接走出屏幕了" /
    // "顶部好像还有一段距离"). `Monitor::work_area()` is Tauri's cross-platform equivalent
    // of `NSScreen.visibleFrame` - see the matching change to the window's own
    // position/size in setup() below, which must use the same rect.
    let work_area = monitor.work_area();
    Ok(MonitorPayload {
        x: work_area.position.x,
        y: work_area.position.y,
        width: work_area.size.width,
        height: work_area.size.height,
        scale_factor: monitor.scale_factor(),
    })
}

#[tauri::command]
fn set_scale(app: tauri::AppHandle, state: State<TrayState>, scale: f64) {
    state.apply_scale(&app, scale);
}

#[tauri::command]
fn set_companion_visible(app: tauri::AppHandle, state: State<TrayState>, visible: bool) {
    state.set_visible(&app, visible);
}

#[tauri::command]
fn set_interaction_mode(app: tauri::AppHandle, state: State<TrayState>, mode: String) {
    state.apply_mode(&app, &mode);
}

#[tauri::command]
fn set_cat_identity(app: tauri::AppHandle, state: State<TrayState>, name: String, personality: String) {
    state.apply_identity(&app, &name, &personality);
}

#[tauri::command]
fn set_active_agent(app: tauri::AppHandle, state: State<TrayState>, agent: String) {
    state.apply_active_agent(&app, &agent);
}

#[tauri::command]
fn set_personality_traits(app: tauri::AppHandle, state: State<TrayState>, traits: PersonalityTraits) {
    state.apply_personality_traits(&app, traits);
}

#[tauri::command]
fn set_behavior_preset(app: tauri::AppHandle, state: State<TrayState>, preset: String) {
    state.apply_behavior_preset(&app, &preset);
}

/// "重置位置": recenter the cat and drop whatever it was doing. A recovery action, not
/// persisted state - just forwarded to the frontend's LifeEngine.resetPosition().
#[tauri::command]
fn reset_position(app: tauri::AppHandle) {
    let _ = app.emit("reset-position", ());
}

#[tauri::command]
fn get_status(state: State<TrayState>) -> serde_json::Value {
    let behavior_preset = state.behavior_preset.lock().unwrap().clone();
    serde_json::json!({
        "scale": *state.current_scale.lock().unwrap(),
        "visible": state.visible.load(Ordering::SeqCst),
        "mode": *state.interaction_mode.lock().unwrap(),
        "catName": *state.cat_name.lock().unwrap(),
        "catPersonality": *state.cat_personality.lock().unwrap(),
        "activeAgent": *state.active_agent.lock().unwrap(),
        "knownAgents": KNOWN_AGENTS,
        "accessibilityTrusted": accessibility_trusted_readonly(),
        "personalityTraits": *state.personality_traits.lock().unwrap(),
        "avoidRadius": avoid_radius_for_preset(&behavior_preset),
        "behaviorPreset": behavior_preset,
        "knownBehaviorPresets": KNOWN_BEHAVIOR_PRESETS,
    })
}

/// Latest PerceptionSnapshot (see packages/perception-contract), pushed by the frontend
/// every couple of seconds and served read-only over the local HTTP bridge below. A future
/// AI driver polls GET /perception rather than reaching into the webview directly.
struct PerceptionState {
    latest_snapshot: Mutex<serde_json::Value>,
}

#[tauri::command]
fn report_perception(state: State<PerceptionState>, snapshot: serde_json::Value) {
    *state.latest_snapshot.lock().unwrap() = snapshot;
}

/// Same snapshot GET /perception serves externally, but for the management window's own
/// "首页" (docs/18 §5.1: "数据源：GET /perception 同源快照...每 2s 轮询"), over the
/// in-process `invoke` bridge instead of a loopback HTTP round trip - the window is already
/// a Tauri webview with command access, so there's no reason to make it open a socket to
/// talk to its own app. Empty `{}` until the companion window's first report_perception
/// call lands (a few seconds after launch, or never if the companion window never opened) -
/// the frontend must treat every field as optional.
#[tauri::command]
fn get_perception(state: State<PerceptionState>) -> serde_json::Value {
    state.latest_snapshot.lock().unwrap().clone()
}

/// docs/contracts' `TaskEvent` shape (packages/contracts/src/index.d.ts) - duplicated here
/// rather than imported, since this crate has no build step to link against a `.mjs`/`.d.ts`
/// package; `TaskStore` in the frontend (management.ts) is what actually validates/dedups
/// against that same shape once this arrives as a Tauri event.
#[derive(Clone, Serialize)]
struct TaskEvent {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    provider: String,
    #[serde(rename = "sourceId")]
    source_id: String,
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "eventId")]
    event_id: String,
    state: String,
    sequence: u64,
    #[serde(rename = "observedAt")]
    observed_at: u64,
    summary: String,
}

/// docs/09's verified Claude Code hooks path, fed by POST /task-event (see
/// spawn_perception_server) - a bounded ring buffer so the management window's Agent 接入
/// page has something to show immediately on open, not just live events from that point on.
struct ClaudeHooksState {
    events: Mutex<Vec<TaskEvent>>, // most recent last
    sequence: Mutex<u64>,
}

const CLAUDE_TASK_EVENT_CAP: usize = 50;

/// Maps the raw JSON Claude Code hands a hook command on stdin (session_id, hook_event_name,
/// plus event-specific fields - verified against https://code.claude.com/docs/en/hooks) into
/// this app's `TaskEvent` shape. Deliberately session-granularity, not sub-task: docs/09
/// already flags "Stop 是一轮停止，不等于用户目标完成" - `taskId` == `sourceId` == the
/// Claude session id is an honest v1, not a claim of finer-grained task tracking.
fn normalize_claude_hook_event(raw: &serde_json::Value, sequence: u64) -> TaskEvent {
    let session_id = raw.get("session_id").and_then(|v| v.as_str()).unwrap_or("unknown-session").to_string();
    let hook_event_name = raw.get("hook_event_name").and_then(|v| v.as_str()).unwrap_or("unknown");
    let (state, summary) = match hook_event_name {
        "UserPromptSubmit" => ("running".to_string(), "新一轮对话开始".to_string()),
        "Stop" => {
            let reason = raw.get("stop_reason").and_then(|v| v.as_str()).unwrap_or("end_turn");
            ("completed".to_string(), format!("本轮回复完成（{reason}）"))
        }
        "StopFailure" => {
            let error_type = raw.get("error_type").and_then(|v| v.as_str()).unwrap_or("unknown");
            ("failed".to_string(), format!("本轮因错误终止（{error_type}）"))
        }
        other => ("unknown".to_string(), format!("未识别的事件：{other}")),
    };
    let observed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    TaskEvent {
        schema_version: 1,
        provider: "claude".to_string(),
        source_id: session_id.clone(),
        task_id: session_id.clone(),
        event_id: format!("{session_id}-{hook_event_name}-{observed_at}-{sequence}"),
        state,
        sequence,
        observed_at,
        summary: summary.chars().take(240).collect(), // docs/09's 240-char cap
    }
}

#[tauri::command]
fn get_claude_task_events(state: State<ClaudeHooksState>) -> Vec<TaskEvent> {
    state.events.lock().unwrap().clone()
}

/// The exact command string installed into ~/.claude/settings.json's hooks (see
/// install_claude_hooks) - reads the hook JSON from stdin and forwards it verbatim to
/// /task-event. Two safety properties, both load-bearing:
/// - `|| true` guarantees exit code 0 no matter what curl does. Per the hooks doc, exit code
///   2 on UserPromptSubmit *blocks the user's prompt* and exit 2 on Stop *prevents Claude
///   from stopping* - this hook must never be able to interfere with the user's actual
///   Claude Code session, including when this app isn't running or the port is unreachable.
/// - `-m 2` bounds how long a hung/unreachable server can delay the user's own hook chain.
const CLAUDE_HOOK_COMMAND: &str =
    "curl -s -m 2 -X POST http://127.0.0.1:47811/task-event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true";

const CLAUDE_HOOK_EVENTS: [&str; 3] = ["UserPromptSubmit", "Stop", "StopFailure"];

fn claude_settings_path() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(|home| PathBuf::from(home).join(".claude").join("settings.json"))
}

/// Missing file reads as `{}` (nothing to merge into yet); a file that exists but isn't
/// valid JSON returns an error with **no side effects** - refusing to touch a settings file
/// we can't parse is safer than guessing at a merge (docs/18 §6.2's "不会覆盖已有 hooks").
fn read_claude_settings(path: &PathBuf) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(path) {
        Ok(body) => {
            serde_json::from_str(&body).map_err(|e| format!("{} 不是合法 JSON，未做任何修改：{e}", path.display()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("无法读取 {}：{e}", path.display())),
    }
}

fn write_claude_settings(path: &PathBuf, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Whether `CLAUDE_HOOK_COMMAND` is already present under a given hooks[event] array -
/// shared by install (skip re-adding) and uninstall (find exactly what to remove), so the
/// two can never disagree about what "ours" means.
fn has_our_hook(entries: &[serde_json::Value]) -> bool {
    entries.iter().any(|entry| {
        entry
            .get("hooks")
            .and_then(|h| h.as_array())
            .map(|inner| inner.iter().any(|h| h.get("command").and_then(|c| c.as_str()) == Some(CLAUDE_HOOK_COMMAND)))
            .unwrap_or(false)
    })
}

/// "一键接入" (docs/18 §6.2): merges `CLAUDE_HOOK_COMMAND` into
/// `UserPromptSubmit`/`Stop`/`StopFailure`, appending to each event's array rather than
/// replacing it - any hooks the user already had stay exactly as they were. Backs up the
/// pre-existing file first (single generation, `.lingxi-backup` - see `uninstall` for the
/// removal path, which is preferred over restoring from backup since it can't undo hooks the
/// user added *after* install ran).
#[tauri::command]
fn install_claude_hooks() -> Result<String, String> {
    let path = claude_settings_path().ok_or_else(|| "找不到 HOME 目录".to_string())?;
    let mut settings = read_claude_settings(&path)?;

    if path.exists() {
        let backup = path.with_extension("json.lingxi-backup");
        let _ = std::fs::copy(&path, &backup);
    }

    let hooks = settings
        .as_object_mut()
        .ok_or_else(|| format!("{} 顶层不是 JSON 对象，未做任何修改", path.display()))?
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks.as_object_mut().ok_or_else(|| "\"hooks\" 字段不是 JSON 对象，未做任何修改".to_string())?;

    for event in CLAUDE_HOOK_EVENTS {
        let entries = hooks_obj.entry(event).or_insert_with(|| serde_json::json!([]));
        let Some(entries_arr) = entries.as_array_mut() else {
            return Err(format!("\"hooks.{event}\" 不是数组，未做任何修改"));
        };
        if !has_our_hook(entries_arr) {
            entries_arr.push(serde_json::json!({ "hooks": [ { "type": "command", "command": CLAUDE_HOOK_COMMAND } ] }));
        }
    }

    write_claude_settings(&path, &settings)?;
    Ok(format!("已写入 {}（原文件已备份为 .lingxi-backup）", path.display()))
}

/// The rollback path (docs/18 §6.2's "备份+回退"): removes exactly the entries
/// `install_claude_hooks` would recognize as its own, leaving everything else - including
/// hooks added by the user or another tool after install ran - untouched.
#[tauri::command]
fn uninstall_claude_hooks() -> Result<String, String> {
    let path = claude_settings_path().ok_or_else(|| "找不到 HOME 目录".to_string())?;
    let mut settings = read_claude_settings(&path)?;
    let Some(hooks_obj) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return Ok("没有发现已安装的 hooks".to_string());
    };
    for event in CLAUDE_HOOK_EVENTS {
        if let Some(entries_arr) = hooks_obj.get_mut(event).and_then(|e| e.as_array_mut()) {
            entries_arr.retain(|entry| {
                !entry
                    .get("hooks")
                    .and_then(|h| h.as_array())
                    .map(|inner| {
                        inner.iter().any(|h| h.get("command").and_then(|c| c.as_str()) == Some(CLAUDE_HOOK_COMMAND))
                    })
                    .unwrap_or(false)
            });
        }
    }
    write_claude_settings(&path, &settings)?;
    Ok("已移除".to_string())
}

/// Read-only check so the management window shows the right state on open, even after an
/// app restart where `ClaudeHooksState`'s in-memory event buffer is empty again.
#[tauri::command]
fn claude_hooks_installed() -> bool {
    let Some(path) = claude_settings_path() else { return false };
    let Ok(settings) = read_claude_settings(&path) else { return false };
    CLAUDE_HOOK_EVENTS.iter().any(|event| {
        settings
            .get("hooks")
            .and_then(|h| h.get(event))
            .and_then(|e| e.as_array())
            .map(|entries| has_our_hook(entries))
            .unwrap_or(false)
    })
}

const PERCEPTION_HTTP_PORT: u16 = 47811;

fn json_response(status: u16, body: String) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let content_type = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    // Loopback-only server (see spawn_perception_server), so a permissive CORS header just
    // makes it usable from a browser-based debug tool too - it does not widen network exposure.
    let cors = tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
    tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(content_type)
        .with_header(cors)
}

/// Minimal local HTTP bridge for an external AI driver process (anything that can speak
/// HTTP - a Node/Python script, a local agent harness, curl for manual testing):
/// - GET  /perception -> the latest PerceptionSnapshot JSON
/// - POST /intent     -> body is an AIIntent JSON object; emitted to the frontend as
///                       "ai-intent", which feeds LifeEngine.suggestMoveTo (a bounded,
///                       droppable suggestion - see packages/life-engine)
///
/// Bound to 127.0.0.1 only - never 0.0.0.0 - so this never becomes reachable from the
/// network, only from other processes on the same machine.
fn spawn_perception_server(app: tauri::AppHandle) {
    thread::spawn(move || {
        // A just-killed previous instance can leave the port in TIME_WAIT for a moment -
        // binding immediately after a restart has failed with "Address already in use"
        // more than once in practice. Retry briefly instead of giving up for the process's
        // entire lifetime over a race that clears itself within a second or two.
        let mut attempt = 0;
        let server = loop {
            match tiny_http::Server::http(("127.0.0.1", PERCEPTION_HTTP_PORT)) {
                Ok(s) => break s,
                Err(e) if attempt < 10 => {
                    attempt += 1;
                    eprintln!(
                        "[lingxi-desktop] perception HTTP server bind attempt {attempt} failed ({e}), retrying..."
                    );
                    thread::sleep(Duration::from_millis(300));
                }
                Err(e) => {
                    eprintln!("[lingxi-desktop] perception HTTP server failed to bind 127.0.0.1:{PERCEPTION_HTTP_PORT} after {attempt} retries: {e}");
                    return;
                }
            }
        };
        eprintln!("[lingxi-desktop] perception HTTP bridge listening on http://127.0.0.1:{PERCEPTION_HTTP_PORT}");
        for mut request in server.incoming_requests() {
            let method = request.method().clone();
            let url = request.url().to_string();
            let response = match (method, url.as_str()) {
                (tiny_http::Method::Get, "/perception") => {
                    let state = app.state::<PerceptionState>();
                    let body = state.latest_snapshot.lock().unwrap().to_string();
                    json_response(200, body)
                }
                (tiny_http::Method::Post, "/intent") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    match serde_json::from_str::<serde_json::Value>(&body) {
                        Ok(intent) => {
                            let _ = app.emit("ai-intent", intent);
                            json_response(200, "{\"ok\":true}".to_string())
                        }
                        Err(e) => json_response(400, format!("{{\"error\":\"invalid JSON body: {e}\"}}")),
                    }
                }
                // Fed by CLAUDE_HOOK_COMMAND once install_claude_hooks has run - see that
                // function and normalize_claude_hook_event's doc comments. Never returns a
                // non-2xx for a body that merely fails to parse as a *recognized* hook event
                // (only truly invalid JSON is rejected) - StopFailure's hook output is
                // ignored by Claude Code entirely, but UserPromptSubmit/Stop are not, and
                // CLAUDE_HOOK_COMMAND's `|| true` means our own exit code can't block
                // anything either way - this 200 is just "received", not "understood".
                (tiny_http::Method::Post, "/task-event") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    match serde_json::from_str::<serde_json::Value>(&body) {
                        Ok(raw) => {
                            let state = app.state::<ClaudeHooksState>();
                            let seq = {
                                let mut seq = state.sequence.lock().unwrap();
                                *seq += 1;
                                *seq
                            };
                            let event = normalize_claude_hook_event(&raw, seq);
                            {
                                let mut events = state.events.lock().unwrap();
                                events.push(event.clone());
                                if events.len() > CLAUDE_TASK_EVENT_CAP {
                                    let overflow = events.len() - CLAUDE_TASK_EVENT_CAP;
                                    events.drain(0..overflow);
                                }
                            }
                            let _ = app.emit("claude-task-event", &event);
                            json_response(200, "{\"ok\":true}".to_string())
                        }
                        Err(e) => json_response(400, format!("{{\"error\":\"invalid JSON body: {e}\"}}")),
                    }
                }
                (tiny_http::Method::Options, _) => json_response(204, String::new()),
                _ => json_response(404, "{\"error\":\"not found\"}".to_string()),
            };
            let _ = request.respond(response);
        }
    });
}

/// Poll the OS-level cursor position and emit it as "global-cursor" events, independent
/// of window hit-testing (a click-through window receives no ordinary mouse events at all).
///
/// Uses `NSEvent.mouseLocation` - a plain AppKit class property read, not an event tap or
/// global monitor - so unlike the device_query-based approach this originally shipped with,
/// it needs **no Accessibility permission**. `NSEvent.mouseLocation` is in points, origin at
/// the bottom-left of the primary screen; converted here to physical pixels with a top-left
/// origin to match `MonitorPayload`/the rest of this file's convention.
#[cfg(target_os = "macos")]
fn spawn_cursor_poller(app: tauri::AppHandle, screen_height_points: f64, scale_factor: f64) {
    thread::spawn(move || {
        let mut last = (i32::MIN, i32::MIN);
        loop {
            let (x, y) = autoreleasepool(|_| {
                let point = NSEvent::mouseLocation();
                let physical_x = (point.x * scale_factor).round() as i32;
                let physical_y = ((screen_height_points - point.y) * scale_factor).round() as i32;
                (physical_x, physical_y)
            });
            if (x, y) != last {
                last = (x, y);
                let _ = app.emit("global-cursor", CursorPayload { x, y });
            }
            thread::sleep(Duration::from_millis(16)); // ~60Hz
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn spawn_cursor_poller(_app: tauri::AppHandle, _screen_height_points: f64, _scale_factor: f64) {
    eprintln!("[lingxi-desktop] global cursor polling is only implemented for macOS so far");
}

fn build_tray(app: &tauri::AppHandle, settings_path: Option<PathBuf>) -> tauri::Result<TrayState> {
    let size_small = CheckMenuItem::with_id(app, "size-small", "小 (0.25x)", true, false, None::<&str>)?;
    let size_medium = CheckMenuItem::with_id(app, "size-medium", "中 (0.5x)", true, false, None::<&str>)?;
    let size_large = CheckMenuItem::with_id(app, "size-large", "大 (1x)", true, true, None::<&str>)?;
    let shape_submenu = Submenu::with_items(app, "形状", true, &[&size_small, &size_medium, &size_large])?;

    let play_mode = CheckMenuItem::with_id(app, "toggle-play-mode", "逗猫模式", true, false, None::<&str>)?;
    let work_mode = CheckMenuItem::with_id(app, "toggle-work-mode", "工作模式", true, true, None::<&str>)?;
    let mode_submenu = Submenu::with_items(app, "模式", true, &[&play_mode, &work_mode])?;

    // "主界面" first, per the requested layout - it's the primary entry point (identity,
    // agent connection, settings), with the tray itself staying a lean quick-access menu.
    let main_window = MenuItem::with_id(app, "main-window", "主界面", true, None::<&str>)?;
    let toggle_visibility = MenuItem::with_id(app, "toggle-visibility", "隐藏", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出灵犀", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &main_window,
            &PredefinedMenuItem::separator(app)?,
            &shape_submenu,
            &mode_submenu,
            &PredefinedMenuItem::separator(app)?,
            &toggle_visibility,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    // A full-color pastel icon (even with an outline) is too low-contrast/detailed to read
    // at real menu-bar size (~20px) against both light and dark menu bars - confirmed by
    // direct user report after shipping that version. tray-icon.png is now a bold, simple,
    // solid-black silhouette; icon_as_template tells macOS to treat it as a template image
    // (the standard convention for menu bar icons: auto-inverts to white in dark mode, gets
    // tinted correctly on hover/click) - see https://docs.rs/tauri/latest/tauri/tray/struct.TrayIconBuilder.html.
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(tray_icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("灵犀")
        .on_menu_event(move |app, event| {
            let state = app.state::<TrayState>();
            match event.id().as_ref() {
                "size-small" => state.apply_scale(app, SCALE_SMALL),
                "size-medium" => state.apply_scale(app, SCALE_MEDIUM),
                "size-large" => state.apply_scale(app, SCALE_LARGE),
                "toggle-play-mode" => state.apply_mode(app, MODE_PLAY),
                "toggle-work-mode" => state.apply_mode(app, MODE_AUTO),
                "main-window" => open_or_focus_management_window(app),
                "toggle-visibility" => {
                    let next = !state.visible.load(Ordering::SeqCst);
                    state.set_visible(app, next);
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    Ok(TrayState {
        size_small,
        size_medium,
        size_large,
        play_mode,
        work_mode,
        toggle_visibility,
        visible: AtomicBool::new(true),
        current_scale: Mutex::new(SCALE_LARGE),
        interaction_mode: Mutex::new(MODE_AUTO.to_string()),
        cat_name: Mutex::new(DEFAULT_CAT_NAME.to_string()),
        cat_personality: Mutex::new(String::new()),
        active_agent: Mutex::new(default_active_agent()),
        personality_traits: Mutex::new(PersonalityTraits::defaults()),
        behavior_preset: Mutex::new(default_behavior_preset()),
        settings_path,
    })
}

fn open_or_focus_management_window(app: &tauri::AppHandle) {
    if let Some(existing) = app.get_webview_window("management") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    let builder = WebviewWindowBuilder::new(app, "management", WebviewUrl::App("management.html".into()))
        .title("灵犀 · 主界面")
        .inner_size(640.0, 560.0)
        .resizable(false)
        .visible(true);
    if let Err(e) = builder.build() {
        eprintln!("[lingxi-desktop] failed to open management window: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            primary_monitor_bounds,
            debug_log,
            set_scale,
            set_companion_visible,
            set_interaction_mode,
            set_cat_identity,
            set_active_agent,
            set_personality_traits,
            set_behavior_preset,
            reset_position,
            get_status,
            report_perception,
            get_perception,
            get_claude_task_events,
            install_claude_hooks,
            uninstall_claude_hooks,
            claude_hooks_installed
        ])
        .setup(|app| {
            // Show the app in the Dock (user request 2026-09-12: "运行时展示在 dock 中").
            // The tray stays as the always-available control surface; Regular policy
            // additionally makes the Dock icon act as a "bring the pet back" entry -
            // see the RunEvent::Reopen handler below.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let window = app
                .get_webview_window("companion")
                .expect("the 'companion' window must be declared in tauri.conf.json");

            // Cover the visible work area (not the full physical monitor) so the character
            // can walk anywhere the user can actually see - see primary_monitor_bounds'
            // matching doc comment for why the full-monitor version let the cat's logical
            // "edge" land under the menu bar/Dock, or effectively off the window entirely.
            // IMPORTANT: do this while the window is already visible (its default state -
            // do not set `"visible": false` in tauri.conf.json and call show() here instead).
            // That combination empirically breaks compositing on macOS: AppKit reports
            // is_visible()==true and the size/position calls "succeed", but the window never
            // actually appears in the WindowServer's onscreen list (cross-checked with
            // CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly) - see
            // docs/16-desktop-shell-prototype.md for the full diagnostic trail).
            let mut screen_height_points = 956.0;
            let mut scale_factor = 2.0;
            if let Ok(Some(monitor)) = window.primary_monitor() {
                // The full panel's height, in points, is still what the cursor poller needs
                // (NSEvent.mouseLocation's y-flip is defined relative to the whole screen,
                // not the work area - see spawn_cursor_poller) - only the window's own
                // geometry below switches to the work area.
                let size = monitor.size();
                scale_factor = monitor.scale_factor();
                screen_height_points = size.height as f64 / scale_factor;
                let work_area = monitor.work_area();
                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: work_area.position.x,
                    y: work_area.position.y,
                }));
                let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: work_area.size.width,
                    height: work_area.size.height,
                }));
            }

            // Start fully click-through; the frontend flips this per-frame based on
            // whether the (globally-polled) cursor is over the model's hit region.
            let _ = window.set_ignore_cursor_events(true);

            spawn_cursor_poller(app.handle().clone(), screen_height_points, scale_factor);

            let trusted = accessibility_permission_ready();
            let _ = app.handle().emit("accessibility-permission", trusted);
            if !trusted {
                eprintln!(
                    "[lingxi-desktop] Accessibility permission not granted. This no longer blocks \
                     cursor tracking or dragging (both now use permission-free APIs) - it only \
                     affects a future global click/keystroke listener that does not exist yet."
                );
            }

            // Settings persist across restarts (size / visibility / mode). Resolved
            // before the tray is built so TrayState can write on every change.
            let settings_path = app
                .path()
                .app_config_dir()
                .ok()
                .map(|dir| dir.join("settings.json"));

            let tray_state = build_tray(app.handle(), settings_path.clone())
                .expect("failed to build the tray icon/menu");
            app.manage(tray_state);

            // Restore persisted settings before the webviews finish loading. The
            // broadcast events emitted here reach no frontend yet (they may not be
            // listening) - the companion webview pulls the authoritative state once
            // via get_status at startup, so nothing is lost.
            let saved = load_persisted_settings(settings_path.as_ref());
            {
                let state = app.state::<TrayState>();
                let handle = app.handle();
                state.apply_scale(handle, saved.scale);
                state.apply_mode(handle, &saved.mode);
                state.apply_identity(handle, &saved.cat_name, &saved.cat_personality);
                state.apply_active_agent(handle, &saved.active_agent);
                state.apply_personality_traits(handle, saved.personality_traits.clone());
                state.apply_behavior_preset(handle, &saved.behavior_preset);
                if !saved.visible {
                    // Same code path as the runtime tray toggle. The companion window
                    // must still be created visible (see the compositing note above);
                    // hiding an already-shown window is the normal, working direction.
                    state.set_visible(handle, false);
                }
            }

            app.manage(PerceptionState { latest_snapshot: Mutex::new(serde_json::json!({})) });
            app.manage(ClaudeHooksState { events: Mutex::new(Vec::new()), sequence: Mutex::new(0) });
            spawn_perception_server(app.handle().clone());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS Dock icon click (LaunchServices "reopen"): the pet is the app's only
            // visible surface, so a reopen means "make the pet visible again" - either it
            // was hidden via the tray, or it is already on screen and a focus attempt is
            // harmless. Same TrayState path as the tray's 显示/隐藏 item, so the tray
            // label and checkmarks stay in sync.
            if let tauri::RunEvent::Reopen { .. } = event {
                let state = app.state::<TrayState>();
                if !state.visible.load(Ordering::SeqCst) {
                    state.set_visible(app, true);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway unique path under the system temp dir; no external temp-dir crate
    /// just for three tests.
    fn temp_settings_path(tag: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "lingxi-test-settings-{}-{}.json",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn normalize_claude_hook_event_maps_each_known_event_to_the_right_task_state() {
        let user_prompt = serde_json::json!({ "session_id": "s1", "hook_event_name": "UserPromptSubmit" });
        assert_eq!(normalize_claude_hook_event(&user_prompt, 1).state, "running");

        let stop = serde_json::json!({ "session_id": "s1", "hook_event_name": "Stop", "stop_reason": "end_turn" });
        let stop_event = normalize_claude_hook_event(&stop, 2);
        assert_eq!(stop_event.state, "completed");
        assert!(stop_event.summary.contains("end_turn"));

        let failure = serde_json::json!({ "session_id": "s1", "hook_event_name": "StopFailure", "error_type": "rate_limit" });
        let failure_event = normalize_claude_hook_event(&failure, 3);
        assert_eq!(failure_event.state, "failed");
        assert!(failure_event.summary.contains("rate_limit"));

        // sourceId/taskId are the session id - session granularity, not sub-task (see the
        // function's own doc comment on why)
        assert_eq!(stop_event.source_id, "s1");
        assert_eq!(stop_event.task_id, "s1");
    }

    #[test]
    fn normalize_claude_hook_event_never_panics_on_missing_fields() {
        let empty = serde_json::json!({});
        let event = normalize_claude_hook_event(&empty, 1);
        assert_eq!(event.state, "unknown");
        assert_eq!(event.source_id, "unknown-session");
    }

    #[test]
    fn install_claude_hooks_appends_without_clobbering_existing_hooks() {
        let path = temp_settings_path("claude-install");
        std::fs::write(
            &path,
            serde_json::json!({
                "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "echo pre-existing" } ] } ] }
            })
            .to_string(),
        )
        .unwrap();

        let mut settings = read_claude_settings(&path).unwrap();
        let hooks_obj = settings.as_object_mut().unwrap().entry("hooks").or_insert_with(|| serde_json::json!({}));
        let hooks_obj = hooks_obj.as_object_mut().unwrap();
        for event in CLAUDE_HOOK_EVENTS {
            let entries_arr = hooks_obj.entry(event).or_insert_with(|| serde_json::json!([])).as_array_mut().unwrap();
            if !has_our_hook(entries_arr) {
                entries_arr.push(serde_json::json!({ "hooks": [ { "type": "command", "command": CLAUDE_HOOK_COMMAND } ] }));
            }
        }
        write_claude_settings(&path, &settings).unwrap();

        let reloaded = read_claude_settings(&path).unwrap();
        let prompt_hooks = reloaded["hooks"]["UserPromptSubmit"].as_array().unwrap();
        assert_eq!(prompt_hooks.len(), 2); // pre-existing + ours, neither clobbered the other
        assert!(has_our_hook(prompt_hooks));
        assert!(has_our_hook(reloaded["hooks"]["Stop"].as_array().unwrap()));
        assert!(has_our_hook(reloaded["hooks"]["StopFailure"].as_array().unwrap()));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_claude_settings_refuses_invalid_json_instead_of_guessing() {
        let path = temp_settings_path("claude-invalid");
        std::fs::write(&path, "{ not valid json").unwrap();
        assert!(read_claude_settings(&path).is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_claude_settings_treats_a_missing_file_as_empty_object() {
        let path = temp_settings_path("claude-missing");
        assert_eq!(read_claude_settings(&path).unwrap(), serde_json::json!({}));
    }

    #[test]
    fn load_falls_back_to_defaults_when_file_is_missing() {
        let path = temp_settings_path("missing");
        let settings = load_persisted_settings(Some(&path));
        assert_eq!(settings, PersistedSettings::defaults());
    }

    #[test]
    fn load_falls_back_to_defaults_when_path_is_none() {
        assert_eq!(load_persisted_settings(None), PersistedSettings::defaults());
    }

    #[test]
    fn load_rejects_unknown_scale_and_mode() {
        let path = temp_settings_path("corrupt");
        let body = serde_json::json!({ "version": 1, "scale": 7.0, "visible": false, "mode": "turbo" });
        std::fs::write(&path, body.to_string()).unwrap();
        let settings = load_persisted_settings(Some(&path));
        assert_eq!(settings.scale, SCALE_LARGE);
        assert_eq!(settings.mode, MODE_AUTO);
        // visibility is a plain bool - it round-trips untouched
        assert!(!settings.visible);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_accepts_every_tray_preset_exactly() {
        for preset in [SCALE_SMALL, SCALE_MEDIUM, SCALE_LARGE] {
            let path = temp_settings_path("preset");
            let body = serde_json::json!({ "version": 1, "scale": preset, "visible": true, "mode": MODE_AUTO });
            std::fs::write(&path, body.to_string()).unwrap();
            assert_eq!(load_persisted_settings(Some(&path)).scale, preset);
            let _ = std::fs::remove_file(&path);
        }
    }

    #[test]
    fn load_defaults_identity_fields_when_absent_from_an_older_settings_file() {
        let path = temp_settings_path("pre-identity");
        let body = serde_json::json!({ "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_AUTO });
        std::fs::write(&path, body.to_string()).unwrap();
        let settings = load_persisted_settings(Some(&path));
        assert_eq!(settings.cat_name, DEFAULT_CAT_NAME);
        assert_eq!(settings.cat_personality, "");
        assert_eq!(settings.active_agent, "none");
        assert_eq!(settings.personality_traits, PersonalityTraits::defaults());
        assert_eq!(settings.behavior_preset, DEFAULT_BEHAVIOR_PRESET);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_rejects_unknown_behavior_preset() {
        let path = temp_settings_path("bad-behavior");
        let body = serde_json::json!({
            "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_AUTO,
            "behavior_preset": "hyperactive"
        });
        std::fs::write(&path, body.to_string()).unwrap();
        let settings = load_persisted_settings(Some(&path));
        assert_eq!(settings.behavior_preset, DEFAULT_BEHAVIOR_PRESET); // unknown preset falls back
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_clamps_out_of_range_personality_traits_instead_of_rejecting_the_whole_file() {
        // Only in-range-shaped-but-out-of-domain values (a hand-edited "1.8" typo'd in place
        // of "0.8") are exercised here: JSON has no NaN/Infinity literal, so a real settings
        // file can never hand serde a non-finite f64 - that branch of `clamped()` is
        // defensive-only and covered directly by `PersonalityTraits::clamped` below instead.
        let path = temp_settings_path("bad-traits");
        let body = serde_json::json!({
            "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_AUTO,
            "personality_traits": {
                "independence": 1.8, "curiosity": -0.5, "gentleness": 0.4,
                "playfulness": 0.9, "sleepiness": 0.0
            }
        });
        std::fs::write(&path, body.to_string()).unwrap();
        let settings = load_persisted_settings(Some(&path));
        assert_eq!(settings.personality_traits.independence, 1.0); // clamped to the top
        assert_eq!(settings.personality_traits.curiosity, 0.0); // clamped to the bottom
        assert_eq!(settings.personality_traits.gentleness, 0.4); // valid value passes through
        assert_eq!(settings.personality_traits.playfulness, 0.9);
        assert_eq!(settings.personality_traits.sleepiness, 0.0);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn personality_traits_clamped_falls_back_to_midpoint_for_non_finite_values() {
        let traits = PersonalityTraits {
            independence: f64::NAN,
            curiosity: f64::INFINITY,
            gentleness: f64::NEG_INFINITY,
            playfulness: 0.7,
            sleepiness: 0.5,
        }
        .clamped();
        assert_eq!(traits.independence, 0.5);
        assert_eq!(traits.curiosity, 0.5);
        assert_eq!(traits.gentleness, 0.5);
        assert_eq!(traits.playfulness, 0.7);
    }

    #[test]
    fn avoid_radius_preset_mapping_keeps_lively_equal_to_the_life_engine_default() {
        // life-engine's own DEFAULTS.avoidRadius is 150 - "活泼" must match it exactly so
        // that never opening "性格行为" (or explicitly picking 活泼) changes nothing about
        // today's avoidance behavior.
        assert_eq!(avoid_radius_for_preset("lively"), 150.0);
        assert_eq!(avoid_radius_for_preset("balanced"), 100.0);
        assert_eq!(avoid_radius_for_preset("quiet"), 70.0);
        assert_eq!(avoid_radius_for_preset("nonsense"), 150.0); // unknown falls back to lively
    }

    #[test]
    fn load_rejects_unknown_agent_and_blank_name() {
        let path = temp_settings_path("bad-identity");
        let body = serde_json::json!({
            "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_AUTO,
            "cat_name": "   ", "cat_personality": "好奇", "active_agent": "gpt5"
        });
        std::fs::write(&path, body.to_string()).unwrap();
        let settings = load_persisted_settings(Some(&path));
        assert_eq!(settings.cat_name, DEFAULT_CAT_NAME); // blank falls back, doesn't stay blank
        assert_eq!(settings.cat_personality, "好奇"); // valid field passes through
        assert_eq!(settings.active_agent, "none"); // unknown agent falls back
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn saved_settings_round_trip_through_disk() {
        let path = temp_settings_path("roundtrip");
        let original = PersistedSettings {
            version: 1,
            scale: SCALE_MEDIUM,
            visible: false,
            mode: MODE_PLAY.to_string(),
            cat_name: "小灵".to_string(),
            cat_personality: "爱睡觉".to_string(),
            active_agent: "codex".to_string(),
            personality_traits: PersonalityTraits {
                independence: 0.8,
                curiosity: 0.6,
                gentleness: 0.3,
                playfulness: 0.9,
                sleepiness: 0.2,
            },
            behavior_preset: "quiet".to_string(),
        };
        // Serialize the same way TrayState::persist does (tmp file + rename) and load
        // it back through the same loader the app startup uses.
        let body = serde_json::to_string_pretty(&original).unwrap();
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, body).unwrap();
        std::fs::rename(&tmp, &path).unwrap();
        assert_eq!(load_persisted_settings(Some(&path)), original);
        let _ = std::fs::remove_file(&path);
    }
}
