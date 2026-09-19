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

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
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

/// Read-only Accessibility trust check. NEVER shows the system permission dialog.
///
/// This is the ONLY form of the check the app has, and that is deliberate: **nothing here
/// actually uses the Accessibility permission**. Cursor tracking reads `NSEvent.mouseLocation`,
/// a plain AppKit property that needs no entitlement (see poll_global_cursor), and dragging
/// uses ordinary window events. The permission was only ever wanted for a global click and
/// keystroke listener that has never been built.
///
/// Startup used to call a prompting variant, so the app raised a system permission dialog for
/// a capability it does not use. Worse, the grant does not survive a rebuild: macOS keys TCC
/// grants on the code signature, and every locally-built bundle is signed afresh, so the user
/// grants it, rebuilds, and is asked again - "我已经开启授权了依然会弹". Reported twice, and
/// each previous fix only narrowed WHERE it was asked from rather than asking whether it
/// should be asked at all.
///
/// If a feature that genuinely needs it ever lands, prompt from THAT feature, when the user
/// turns it on, with `application_is_trusted_with_prompt()` - not at startup for everyone.
#[cfg(target_os = "macos")]
fn accessibility_trusted_readonly() -> bool {
    macos_accessibility_client::accessibility::application_is_trusted()
}

#[cfg(not(target_os = "macos"))]
fn accessibility_trusted_readonly() -> bool {
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

/// There is one mode now (free roaming; playing is "a toy is out"), so the old auto/play
/// setting is gone. The constant survives only as the value `mode` still reports over the
/// HTTP bridge, because an agent written against the previous build reads that field.
const MODE_FREE: &str = "free";

/// The AI coding agents this build knows how to name/select in the "Agent 接入" page.
/// "none" means no agent is treated as actively connected. This is a *label* today - see
/// the doc comment on `set_active_agent` for what it does and, honestly, doesn't yet do.
const KNOWN_AGENTS: [&str; 4] = ["none", "dsh", "codex", "claude"];
const DEFAULT_CAT_NAME: &str = "灵犀";

/// Visual themes ("主题"). Ids must match apps/lingxi/src/data/skins.json - that file is the
/// actual asset catalogue (colours, pattern generator, atelier PNG variants); Rust only
/// persists which one is selected and rejects ids it has never heard of, so a hand-edited
/// settings.json can't leave the companion window trying to mount a theme that doesn't
/// exist. Adding a theme means adding it in both places.
const KNOWN_SKINS: [&str; 9] = [
    "honey-mittens",
    "silver-brook",
    "calico-poem",
    "apricot-letter",
    "moon-oat",
    "mist-blue",
    "cocoa-snow",
    "peach-cloud",
    "ink-sesame",
];
const DEFAULT_SKIN: &str = "honey-mittens";

/// Viewing angles ("视角"). Ids must match CAMERA_PRESETS in apps/lingxi/src/renderer.ts,
/// which owns the actual elevation numbers - same split as KNOWN_SKINS above.
const KNOWN_CAMERAS: [&str; 6] = ["look-up", "eye-level", "game", "shoulder", "overhead", "auto"];
const DEFAULT_CAMERA: &str = "game";

/// Toys ("玩具"). Ids must match packages/life-engine's TOY_KINDS - that module owns the
/// simulation (rolling, bouncing, batting); Rust only routes the request. Unlike the theme and
/// camera settings these are deliberately NOT persisted: a toy left on the desktop across a
/// restart would be clutter the user never asked for twice.
const KNOWN_TOYS: [&str; 3] = ["yarn", "feather", "laser"];

/// Scripted set-pieces ("特效"). Ids must match src/fx/performances.ts's PERFORMANCES, which
/// owns the actual choreography.
const KNOWN_PERFORMANCES: [&str; 3] = ["angry-claw", "kiss-rush", "zoomies"];

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
    #[serde(default = "default_skin")]
    skin: String,
    #[serde(default = "default_camera")]
    camera: String,
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

fn default_skin() -> String {
    DEFAULT_SKIN.to_string()
}

fn default_camera() -> String {
    DEFAULT_CAMERA.to_string()
}

impl PersistedSettings {
    fn defaults() -> Self {
        Self {
            version: 1,
            scale: SCALE_LARGE,
            visible: true,
            mode: MODE_FREE.to_string(),
            cat_name: default_cat_name(),
            cat_personality: String::new(),
            active_agent: default_active_agent(),
            personality_traits: PersonalityTraits::defaults(),
            behavior_preset: default_behavior_preset(),
            skin: default_skin(),
            camera: default_camera(),
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
    // Restored as-is rather than checked against the built-in list. At this point in startup
    // the renderer has not reported its catalogue yet, so there is nothing here that could tell
    // a user-authored theme from a typo - and the old check resolved that ambiguity by deleting
    // the user's choice on every single launch. An id the renderer turns out not to have is
    // ignored by setSkin, which leaves the built-in default showing anyway.
    let skin = if settings.skin.trim().is_empty() { default_skin() } else { settings.skin };
    let camera = if KNOWN_CAMERAS.contains(&settings.camera.as_str()) { settings.camera } else { default_camera() };
    PersistedSettings {
        version: 1,
        scale: if known_scale { settings.scale } else { SCALE_LARGE },
        visible: settings.visible,
        mode: MODE_FREE.to_string(),
        cat_name: name,
        cat_personality: personality,
        active_agent: agent,
        personality_traits: settings.personality_traits.clamped(),
        behavior_preset,
        skin,
        camera,
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
    toggle_visibility: MenuItem<tauri::Wry>,
    visible: AtomicBool,
    current_scale: Mutex<f64>,
    cat_name: Mutex<String>,
    cat_personality: Mutex<String>,
    active_agent: Mutex<String>,
    personality_traits: Mutex<PersonalityTraits>,
    behavior_preset: Mutex<String>,
    skin: Mutex<String>,
    camera: Mutex<String>,
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

    /// "外观 / 主题": which of the painted themes the companion window renders. Unlike the
    /// personality sliders, this one is fully live - the renderer rebuilds the rig and
    /// repaints both atlases on the event (see renderer.ts's setSkin).
    ///
    /// The id is NOT checked against the built-in list any more. It used to be, and an id that
    /// failed was silently replaced with the default - which is the right instinct for a
    /// settings.json that outlives an asset list, but it also meant a theme the user had
    /// authored themselves could be loaded, listed by GET /capabilities, clicked in the UI, and
    /// still quietly turn into a different cat with no message anywhere. The renderer is the
    /// only layer that knows the real catalogue (built-ins plus whatever the user wrote), so it
    /// is the layer that decides: setSkin ignores an id it does not have, which leaves the
    /// current theme in place rather than resetting it.
    fn apply_skin(&self, app: &tauri::AppHandle, skin: &str) {
        *self.skin.lock().unwrap() = skin.to_string();
        let _ = app.emit("set-skin", skin);
        self.persist();
    }

    /// "外观 / 视角": the camera angle preset (see renderer.ts's CAMERA_PRESETS). Also live -
    /// the renderer eases from the current angle to the new one.
    fn apply_camera(&self, app: &tauri::AppHandle, camera: &str) {
        let camera = if KNOWN_CAMERAS.contains(&camera) { camera } else { DEFAULT_CAMERA };
        *self.camera.lock().unwrap() = camera.to_string();
        let _ = app.emit("set-camera", camera);
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
            mode: MODE_FREE.to_string(),
            cat_name: self.cat_name.lock().unwrap().clone(),
            cat_personality: self.cat_personality.lock().unwrap().clone(),
            active_agent: self.active_agent.lock().unwrap().clone(),
            personality_traits: self.personality_traits.lock().unwrap().clone(),
            behavior_preset: self.behavior_preset.lock().unwrap().clone(),
            skin: self.skin.lock().unwrap().clone(),
            camera: self.camera.lock().unwrap().clone(),
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

#[tauri::command]
fn set_skin(app: tauri::AppHandle, state: State<TrayState>, skin: String) {
    state.apply_skin(&app, &skin);
}

#[tauri::command]
fn set_camera(app: tauri::AppHandle, state: State<TrayState>, camera: String) {
    state.apply_camera(&app, &camera);
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
        "mode": MODE_FREE,
        "catName": *state.cat_name.lock().unwrap(),
        "catPersonality": *state.cat_personality.lock().unwrap(),
        "activeAgent": *state.active_agent.lock().unwrap(),
        "knownAgents": KNOWN_AGENTS,
        "accessibilityTrusted": accessibility_trusted_readonly(),
        "personalityTraits": *state.personality_traits.lock().unwrap(),
        "avoidRadius": avoid_radius_for_preset(&behavior_preset),
        "behaviorPreset": behavior_preset,
        "knownBehaviorPresets": KNOWN_BEHAVIOR_PRESETS,
        "skin": *state.skin.lock().unwrap(),
        "knownSkins": KNOWN_SKINS,
        "camera": *state.camera.lock().unwrap(),
        "knownCameras": KNOWN_CAMERAS,
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

/// What the companion window's renderer can be asked to do - the clip library, the expression
/// list, the theme catalogue, the camera presets. Pushed up from the frontend at startup
/// (see main.ts's report_capabilities call) rather than duplicated in Rust, because the
/// renderer is the thing that actually owns those lists; Rust only needs to be able to hand
/// them to `GET /capabilities` when the webview isn't in the loop.
struct CapabilitiesState {
    latest: Mutex<serde_json::Value>,
}

#[tauri::command]
fn report_capabilities(state: State<CapabilitiesState>, capabilities: serde_json::Value) {
    *state.latest.lock().unwrap() = capabilities;
}

#[tauri::command]
fn get_capabilities(state: State<CapabilitiesState>) -> serde_json::Value {
    state.latest.lock().unwrap().clone()
}

/// 调试台: play one action clip right now. Same path an agent's `POST /action` takes.
#[tauri::command]
fn play_action(app: tauri::AppHandle, id: String) {
    let _ = app.emit("play-action", serde_json::json!({ "id": id }));
}

/// 调试台: hold one expression. `hold_ms` is a duration, not a latch - an expression that
/// never expires would leave the cat stuck with whatever face a debugging session last poked
/// at, which is exactly the kind of state a debug tool must not be able to create.
#[tauri::command]
fn play_expression(app: tauri::AppHandle, name: String, hold_ms: Option<u64>) {
    let _ = app.emit(
        "play-expression",
        serde_json::json!({ "name": name, "holdMs": hold_ms.unwrap_or(4000) }),
    );
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
/// Apply whichever control fields a `POST /control` body carries, returning (applied,
/// rejected) so the caller gets a precise answer instead of a blanket 200.
///
/// Validation split: anything Rust owns the vocabulary for (mode, camera, theme, scale) is
/// checked here and rejected outright if wrong. Clip ids and expression names belong to the
/// renderer's data files, which Rust deliberately does not duplicate - those are forwarded and
/// validated on arrival (the frontend logs an unknown id), which is why they report as
/// "forwarded" rather than "applied".

/// Longest line the speech bubble can show. Enforced here rather than trusted from the caller,
/// because this is reachable from any process on the loopback interface.
const SAY_MAX_CHARS: usize = 140;
/// Longest a single remembered fact may be.
const MEMORY_MAX_CHARS: usize = 280;
/// Longest a reminder's text may be.
const REMINDER_MAX_CHARS: usize = 140;
/// The only `kind` values `/memory` accepts. The file is plain JSON the user opens and reads,
/// so letting an arbitrary string through is schema drift in a document they own.
const MEMORY_KINDS: [&str; 4] = ["owner", "project", "preference", "moment"];
/// Upper bound on an externally-supplied expression hold. Mirrors the life engine's own cap.
const MAX_HOLD_MS: u64 = 10 * 60 * 1000;

/// Every field `/control` understands. Anything else in the body is a typo, and saying so is
/// the whole point: the old code silently skipped unrecognised keys and then reported
/// "empty command", so a caller who wrote `expresssion` was told they had sent nothing at all
/// and would retry the same misspelling forever.
const CONTROL_FIELDS: [&str; 14] = [
    "mode", "camera", "skin", "scale", "visible", "action", "expression", "holdMs", "perform",
    "toy", "say", "sayMs", "resetPosition", "reloadAssets",
];

/// Pull the ids out of one list in the renderer-reported capability payload.
///
/// Returns None when the list is absent or empty, and every caller MUST read that as "allow
/// through" rather than "reject everything". The webview reports its capabilities a moment
/// after launch, and a control call that lands in that window must not be told the entire
/// clip library is unknown.
fn known_ids(caps: &serde_json::Value, list: &str, key: &str) -> Option<Vec<String>> {
    let entries = caps.get(list)?.as_array()?;
    let ids: Vec<String> = entries
        .iter()
        .filter_map(|entry| match entry {
            serde_json::Value::String(s) => Some(s.clone()),
            other => other.get(key).and_then(|v| v.as_str()).map(|s| s.to_string()),
        })
        .collect();
    if ids.is_empty() { None } else { Some(ids) }
}

/// Validate one id against the renderer's live list, degrading to "allow" when it has not
/// reported yet. `label` names the field in any rejection message.
fn check_known(
    caps: &serde_json::Value,
    list: &str,
    key: &str,
    value: &str,
    label: &str,
) -> Result<(), String> {
    match known_ids(caps, list, key) {
        Some(ids) if !ids.iter().any(|id| id == value) => Err(format!(
            "{label}: unknown {label} \"{value}\" (see GET /capabilities for the {} currently loaded)",
            ids.len()
        )),
        _ => Ok(()),
    }
}

/// Truncate to `max` CHARACTERS (not bytes - the text is Chinese as often as not) and say
/// whether anything was lost, so the caller can be told rather than quietly misinformed.
fn truncate_chars(text: &str, max: usize) -> (String, bool) {
    let trimmed = text.trim();
    let kept: String = trimmed.chars().take(max).collect();
    let truncated = trimmed.chars().count() > max;
    (kept, truncated)
}

/// Reject an intent the cat cannot act on, at the boundary, with a reason.
///
/// The engine drops a malformed target too - that is the fix that matters, since it is what
/// stops the cat vanishing. This is the other half: without it the endpoint still answers
/// `{"ok":true}` to a request it is quietly discarding, which is the same lie in a smaller
/// coat. A caller that sent `{"targetPoint":{}}` because it did not know the field shape needs
/// to be told the shape, not congratulated.
fn validate_intent(intent: &serde_json::Value) -> Result<(), String> {
    let Some(point) = intent.get("targetPoint") else {
        // No target at all is legitimate - an intent may carry only holdMs, or only the legacy
        // `mode` field, and those are handled downstream.
        return Ok(());
    };
    if point.is_null() {
        return Ok(());
    }
    let finite = |key: &str| point.get(key).and_then(|v| v.as_f64()).filter(|n| n.is_finite());
    match (finite("x"), finite("y")) {
        (Some(_), Some(_)) => Ok(()),
        _ => Err(format!(
            "targetPoint must be {{\"x\": <finite number>, \"y\": <finite number>}} in logical \
             screen pixels; got {point}. The values are NOT optional - a partial or non-numeric \
             point is refused rather than guessed at."
        )),
    }
}

fn apply_control_command(
    app: &tauri::AppHandle,
    command: &serde_json::Value,
) -> (Vec<String>, Vec<String>, serde_json::Value) {
    let state = app.state::<TrayState>();
    let mut applied = Vec::new();
    let mut rejected = Vec::new();
    // Extra structured detail for the caller (what a truncation kept, what a reload loaded).
    let mut detail = serde_json::Map::new();
    let caps = app.state::<CapabilitiesState>().latest.lock().unwrap().clone();

    // Anything that is not a field name, and anything that is but holds the wrong type, is
    // named explicitly. All of these used to fall through to "empty command: expected at least
    // one of ...", which tells a caller their request was empty when in fact it was misspelled
    // or mistyped - so they retry it unchanged instead of fixing it.
    if let Some(object) = command.as_object() {
        for (key, value) in object {
            if !CONTROL_FIELDS.contains(&key.as_str()) {
                let hint = CONTROL_FIELDS
                    .iter()
                    .find(|field| field.eq_ignore_ascii_case(key) || looks_like_typo(field, key));
                rejected.push(match hint {
                    Some(field) => format!("unknown field \"{key}\" - did you mean \"{field}\"?"),
                    None => format!("unknown field \"{key}\" (expected one of {CONTROL_FIELDS:?})"),
                });
                continue;
            }
            let type_ok = match key.as_str() {
                "camera" | "skin" | "action" | "expression" | "perform" | "toy" | "say" | "mode" => value.is_string(),
                "scale" => value.is_number(),
                "visible" | "resetPosition" | "reloadAssets" => value.is_boolean(),
                "holdMs" | "sayMs" => value.is_number(),
                _ => true,
            };
            if !type_ok {
                rejected.push(format!(
                    "{key}: expected {}, got {}",
                    expected_type_name(key),
                    json_type_name(value),
                ));
            }
        }
    }

    if command.get("mode").is_some() {
        // Accepted and ignored rather than rejected: an agent written against the two-mode
        // build should not have its whole request fail over a setting that no longer exists.
        applied.push("mode (ignored - there is only one mode now; put a toy out to play)".to_string());
    }
    if let Some(camera) = command.get("camera").and_then(|v| v.as_str()) {
        if KNOWN_CAMERAS.contains(&camera) {
            state.apply_camera(app, camera);
            applied.push(format!("camera={camera}"));
        } else {
            rejected.push(format!("camera: unknown preset \"{camera}\" (see GET /capabilities)"));
        }
    }
    if let Some(skin) = command.get("skin").and_then(|v| v.as_str()) {
        // Validated against what the renderer actually has loaded, NOT against the hardcoded
        // built-in list. A user who authors a theme can load it, see it in GET /capabilities,
        // and still be told it does not exist - which is exactly what was reported. Cameras
        // stay hardcoded on purpose: they are geometry, not content, and do not grow with
        // custom assets (capabilities marks them `fixed: true` so this reads as deliberate).
        match check_known(&caps, "skins", "id", skin, "skin") {
            Ok(()) => {
                state.apply_skin(app, skin);
                applied.push(format!("skin={skin}"));
            }
            Err(message) => rejected.push(message),
        }
    }
    if let Some(scale) = command.get("scale").and_then(|v| v.as_f64()) {
        if [SCALE_SMALL, SCALE_MEDIUM, SCALE_LARGE].iter().any(|p| (p - scale).abs() < f64::EPSILON) {
            state.apply_scale(app, scale);
            applied.push(format!("scale={scale}"));
        } else {
            rejected.push(format!("scale: expected one of {SCALE_SMALL}/{SCALE_MEDIUM}/{SCALE_LARGE}, got {scale}"));
        }
    }
    if let Some(visible) = command.get("visible").and_then(|v| v.as_bool()) {
        state.set_visible(app, visible);
        applied.push(format!("visible={visible}"));
    }
    // action / expression used to be forwarded to the webview unchecked and reported as
    // `applied`, so a typo'd clip id came back 200 "(forwarded)" and the model told the user it
    // had made the cat wave. Nothing downstream reports back, so the forward is the ONLY place
    // this can be caught.
    if let Some(action) = command.get("action").and_then(|v| v.as_str()) {
        if action.trim().is_empty() {
            rejected.push("action: empty id".to_string());
        } else {
            match check_known(&caps, "actions", "id", action, "action") {
                Ok(()) => {
                    let _ = app.emit("play-action", serde_json::json!({ "id": action }));
                    applied.push(format!("action={action}"));
                }
                Err(message) => rejected.push(message),
            }
        }
    }
    if let Some(expression) = command.get("expression").and_then(|v| v.as_str()) {
        if expression.trim().is_empty() {
            rejected.push("expression: empty name".to_string());
        } else {
            match check_known(&caps, "expressions", "name", expression, "expression") {
                Ok(()) => {
                    let requested = command.get("holdMs").and_then(|v| v.as_u64()).unwrap_or(4000);
                    let hold_ms = requested.min(MAX_HOLD_MS);
                    if hold_ms != requested {
                        detail.insert("holdMsClamped".into(), serde_json::json!(hold_ms));
                    }
                    let _ = app.emit(
                        "play-expression",
                        serde_json::json!({ "name": expression, "holdMs": hold_ms }),
                    );
                    applied.push(format!("expression={expression}"));
                }
                Err(message) => rejected.push(message),
            }
        }
    }
    if let Some(id) = command.get("perform").and_then(|v| v.as_str()) {
        if KNOWN_PERFORMANCES.contains(&id) {
            let _ = app.emit("perform", serde_json::json!({ "id": id }));
            applied.push(format!("perform={id}"));
        } else {
            rejected.push(format!("perform: unknown performance \"{id}\" (see GET /capabilities)"));
        }
    }
    if let Some(kind) = command.get("toy").and_then(|v| v.as_str()) {
        if kind == "none" {
            let _ = app.emit("clear-toy", ());
            applied.push("toy=none".to_string());
        } else if KNOWN_TOYS.contains(&kind) {
            let _ = app.emit("set-toy", serde_json::json!({ "kind": kind }));
            applied.push(format!("toy={kind}"));
        } else {
            rejected.push(format!("toy: unknown toy \"{kind}\" (expected one of {KNOWN_TOYS:?} or \"none\")"));
        }
    }
    if let Some(text) = command.get("say").and_then(|v| v.as_str()) {
        let (trimmed, truncated) = truncate_chars(text, SAY_MAX_CHARS);
        if trimmed.is_empty() {
            rejected.push("say: empty text".to_string());
        } else {
            let duration = command.get("sayMs").and_then(|v| v.as_u64());
            let _ = app.emit("say", serde_json::json!({ "text": trimmed.clone(), "durationMs": duration }));
            // Truncation is reported rather than silent. A caller that is told `ok` and gets its
            // own 150-character string echoed back will tell the user the cat said all of it.
            applied.push(if truncated {
                format!("say (truncated to {SAY_MAX_CHARS} characters)")
            } else {
                "say".to_string()
            });
            detail.insert("saidText".into(), serde_json::json!(trimmed));
            detail.insert("truncated".into(), serde_json::json!(truncated));
        }
    }
    if command.get("resetPosition").and_then(|v| v.as_bool()).unwrap_or(false) {
        let _ = app.emit("reset-position", ());
        applied.push("resetPosition".to_string());
    }
    // Re-read the user's assets folder. Previously only a button in the management window could
    // do this, so an agent that wrote an actions.json had no way to make it take effect and no
    // way to read the validation errors if it had got the format wrong - it could only tell the
    // user to go and click something.
    if command.get("reloadAssets").and_then(|v| v.as_bool()).unwrap_or(false) {
        let _ = app.emit("reload-custom-assets", ());
        applied.push("reloadAssets".to_string());
        detail.insert(
            "note".into(),
            serde_json::json!(
                "The reload is asynchronous. Poll GET /assets/status for the validation result -                  lastLoadedAt will move and lastErrors will hold any per-file complaints."
            ),
        );
    }
    if applied.is_empty() && rejected.is_empty() {
        rejected.push(format!(
            "empty command: expected at least one of {CONTROL_FIELDS:?}"
        ));
    }
    (applied, rejected, serde_json::Value::Object(detail))
}

/// Cheap "did they mean this field" check - one edit apart, or a doubled letter. Only used to
/// improve a rejection message, never to guess what the caller meant and act on it.
fn looks_like_typo(field: &str, key: &str) -> bool {
    if key.len() + 1 != field.len() && field.len() + 1 != key.len() && field.len() != key.len() {
        return false;
    }
    let (a, b): (Vec<char>, Vec<char>) = (field.chars().collect(), key.chars().collect());
    let mut differences = 0;
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i] == b[j] {
            i += 1;
            j += 1;
            continue;
        }
        differences += 1;
        if differences > 1 {
            return false;
        }
        match a.len().cmp(&b.len()) {
            std::cmp::Ordering::Greater => i += 1,
            std::cmp::Ordering::Less => j += 1,
            std::cmp::Ordering::Equal => {
                i += 1;
                j += 1;
            }
        }
    }
    differences + (a.len() - i) + (b.len() - j) <= 1
}

fn expected_type_name(field: &str) -> &'static str {
    match field {
        "scale" | "holdMs" | "sayMs" => "a number",
        "visible" | "resetPosition" | "reloadAssets" => "a boolean",
        _ => "a string",
    }
}

fn json_type_name(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "a boolean",
        serde_json::Value::Number(_) => "a number",
        serde_json::Value::String(_) => "a string",
        serde_json::Value::Array(_) => "an array",
        serde_json::Value::Object(_) => "an object",
    }
}

/// Check once a minute for reminders that have come due and have the cat bring them up.
///
/// A minute of granularity is deliberate. This is a pet mentioning something, not an alarm
/// clock, and a reminder that fires to the second would feel like a notification - which is the
/// thing a desktop pet is supposed to be a gentler alternative to.
fn spawn_reminder_ticker(app: tauri::AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(30));
        let state = app.state::<MemoryState>();
        // Claim exactly ONE due reminder per tick, and leave the rest pending.
        //
        // This used to mark every due reminder `done` and then speak only the first, so a user
        // who closed the app over lunch and came back to three expired reminders heard one and
        // silently lost two - they were flagged complete without ever being said. The intent in
        // the original comment is right (a cat that recites a backlog at you is a todo list, not
        // a pet); the implementation has to DEFER the others, not discard them. The next tick is
        // 30 seconds away, so a backlog still drains, one gentle mention at a time.
        let next: Option<Reminder> = {
            let mut reminders = state.reminders.lock().unwrap();
            let now = now_millis();
            reminders
                .iter_mut()
                .filter(|reminder| !reminder.done && reminder.due <= now)
                // Oldest first, so a backlog comes out in the order it was promised.
                .min_by_key(|reminder| reminder.due)
                .map(|reminder| {
                    reminder.done = true;
                    reminder.clone()
                })
        };
        if next.is_none() {
            continue;
        }
        state.persist_reminders();
        if let Some(reminder) = next.as_ref() {
            let _ = app.emit("play-expression", serde_json::json!({ "name": "好奇", "holdMs": 5000 }));
            let _ = app.emit("play-action", serde_json::json!({ "id": "notice-you" }));
            let _ = app.emit(
                "say",
                serde_json::json!({ "text": reminder.text.clone(), "durationMs": 6000 }),
            );
        }
    });
}

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
                // Everything the pet can be told to do, as data: the 40 clips (id, name,
                // category, duration, the expression each one wears), the 30 expressions, the
                // themes, the camera angles. An agent is expected to GET this once and then
                // POST ids from it, rather than hardcoding names that only happen to exist in
                // the build it was written against.
                (tiny_http::Method::Get, "/capabilities") => {
                    let state = app.state::<CapabilitiesState>();
                    let body = state.latest.lock().unwrap().to_string();
                    json_response(200, body)
                }
                // What the user's own assets folder currently contributes, and whether the last
                // read of it complained. Previously the validation errors existed only inside a
                // Tauri command the management window could call, so an agent that wrote a
                // malformed actions.json could not find out - it could only ask the user to open
                // a window and read a line of red text back to it.
                (tiny_http::Method::Get, "/assets/status") => {
                    let caps = app.state::<CapabilitiesState>().latest.lock().unwrap().clone();
                    let assets = caps.get("assets").cloned().unwrap_or(serde_json::Value::Null);
                    let dir = custom_assets_dir(&app).map(|d| d.display().to_string());
                    json_response(
                        200,
                        serde_json::json!({
                            "dir": dir,
                            "active": assets.get("active").cloned().unwrap_or(serde_json::Value::Null),
                            "lastLoadedAt": assets.get("lastLoadedAt").cloned().unwrap_or(serde_json::Value::Null),
                            "lastErrors": assets.get("lastErrors").cloned().unwrap_or(serde_json::json!([])),
                            "reloadWith": "POST /control {\"reloadAssets\": true}",
                        })
                        .to_string(),
                    )
                }
                // The event history, so "why did it do that" is answerable after the fact. The
                // absence of this is what made a reported disappear-and-recover impossible to
                // explain: there was no record of when either happened.
                (tiny_http::Method::Get, "/debug/events") => {
                    let state = app.state::<ClaudeHooksState>();
                    let events = state.events.lock().unwrap().clone();
                    json_response(
                        200,
                        serde_json::json!({
                            "events": events,
                            "cap": CLAUDE_TASK_EVENT_CAP,
                        })
                        .to_string(),
                    )
                }
                // Current settings - the same object the management window reads at open.
                (tiny_http::Method::Get, "/status") => {
                    let state = app.state::<TrayState>();
                    let preset = state.behavior_preset.lock().unwrap().clone();
                    let body = serde_json::json!({
                        "scale": *state.current_scale.lock().unwrap(),
                        "visible": state.visible.load(Ordering::SeqCst),
                        "mode": MODE_FREE,
                        "skin": *state.skin.lock().unwrap(),
                        "camera": *state.camera.lock().unwrap(),
                        "catName": *state.cat_name.lock().unwrap(),
                        "activeAgent": *state.active_agent.lock().unwrap(),
                        "behaviorPreset": preset,
                    });
                    json_response(200, body.to_string())
                }
                // One control endpoint rather than eight: an agent sends whichever of these
                // fields it cares about, in any combination, and each is applied through the
                // exact same path the UI uses (so the tray checkmarks, the management window
                // and the persisted settings all stay in sync with what an agent did).
                // Unknown ids are rejected per-field with a message, not silently ignored -
                // an agent that typo'd a clip name should find out.
                (tiny_http::Method::Post, "/control") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    match serde_json::from_str::<serde_json::Value>(&body) {
                        Ok(command) => {
                            let (applied, rejected, detail) = apply_control_command(&app, &command);
                            let mut body = serde_json::json!({
                                "ok": rejected.is_empty(),
                                "applied": applied,
                                "rejected": rejected,
                            });
                            // Structured extras (what a truncation actually kept, whether a hold
                            // was clamped) are merged in at the top level so a caller can act on
                            // them without parsing prose out of `applied`.
                            if let (Some(object), Some(extra)) = (body.as_object_mut(), detail.as_object()) {
                                for (key, value) in extra {
                                    object.insert(key.clone(), value.clone());
                                }
                            }
                            json_response(
                                if rejected.is_empty() { 200 } else { 400 },
                                body.to_string(),
                            )
                        }
                        Err(e) => json_response(400, format!("{{\"error\":\"invalid JSON body: {e}\"}}")),
                    }
                }
                // --- memory: what the cat knows about its owner ---
                (tiny_http::Method::Get, "/memory") => {
                    let state = app.state::<MemoryState>();
                    let memory = state.memory.lock().unwrap();
                    json_response(200, serde_json::to_string(&*memory).unwrap_or_else(|_| "{}".into()))
                }
                (tiny_http::Method::Post, "/memory") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    match serde_json::from_str::<serde_json::Value>(&body) {
                        Ok(value) => {
                            let text = value.get("text").and_then(|v| v.as_str()).unwrap_or("");
                            let kind = value.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                            let (kept, truncated) = truncate_chars(text, MEMORY_MAX_CHARS);
                            // The enum is enforced here and not only in the MCP schema. memory.json
                            // is a plain file the user opens and reads; anything that reaches this
                            // endpoint over raw HTTP was writing arbitrary `kind` strings straight
                            // into a document they own.
                            if kept.is_empty() {
                                json_response(400, "{\"error\":\"text is required\"}".to_string())
                            } else if !kind.is_empty() && !MEMORY_KINDS.contains(&kind) {
                                json_response(
                                    400,
                                    serde_json::json!({
                                        "error": format!("unknown kind \"{kind}\""),
                                        "expected": MEMORY_KINDS,
                                    })
                                    .to_string(),
                                )
                            } else {
                                app.state::<MemoryState>().remember(&kept, kind);
                                json_response(
                                    200,
                                    serde_json::json!({
                                        "ok": true,
                                        "stored": kept,
                                        "truncated": truncated,
                                    })
                                    .to_string(),
                                )
                            }
                        }
                        Err(e) => json_response(400, format!("{{\"error\":\"invalid JSON body: {e}\"}}")),
                    }
                }
                // --- reminders: things it has promised to bring up later ---
                (tiny_http::Method::Get, "/reminders") => {
                    let state = app.state::<MemoryState>();
                    let reminders = state.reminders.lock().unwrap();
                    json_response(200, serde_json::to_string(&*reminders).unwrap_or_else(|_| "[]".into()))
                }
                (tiny_http::Method::Post, "/reminders") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    match serde_json::from_str::<serde_json::Value>(&body) {
                        Ok(value) => {
                            let (text, truncated) =
                                truncate_chars(value.get("text").and_then(|v| v.as_str()).unwrap_or(""), REMINDER_MAX_CHARS);
                            // Either an absolute time or a delay, whichever the caller finds
                            // easier - an agent usually knows "in 25 minutes", not a timestamp.
                            // Giving BOTH used to let dueAt win silently; the MCP description
                            // says "use this OR dueAt", so a caller that sends both has a bug and
                            // is told about it rather than having one of its two intentions
                            // quietly discarded.
                            let has_both = value.get("dueAt").is_some() && value.get("inMinutes").is_some();
                            let negative_delay = value
                                .get("inMinutes")
                                .and_then(|v| v.as_f64())
                                .is_some_and(|m| m < 0.0);
                            let due = value
                                .get("dueAt")
                                .and_then(|v| v.as_u64())
                                .or_else(|| value.get("inMinutes").and_then(|v| v.as_f64()).map(|m| now_millis() + (m * 60_000.0) as u64));
                            match (text.is_empty(), due) {
                                _ if has_both => json_response(
                                    400,
                                    "{\"error\":\"give either dueAt or inMinutes, not both\"}".to_string(),
                                ),
                                _ if negative_delay => json_response(
                                    400,
                                    "{\"error\":\"inMinutes must be positive - a reminder in the past fires immediately and reads as a bug\"}".to_string(),
                                ),
                                (true, _) => json_response(400, "{\"error\":\"text is required\"}".to_string()),
                                (_, None) => json_response(400, "{\"error\":\"dueAt or inMinutes is required\"}".to_string()),
                                (_, Some(due)) => {
                                    let state = app.state::<MemoryState>();
                                    let id = format!("r{}", now_millis());
                                    {
                                        let mut reminders = state.reminders.lock().unwrap();
                                        reminders.push(Reminder { id: id.clone(), text, due, done: false });
                                        let overflow = reminders.len().saturating_sub(REMINDER_CAP);
                                        if overflow > 0 {
                                            reminders.drain(0..overflow);
                                        }
                                    }
                                    state.persist_reminders();
                                    json_response(
                                        200,
                                        serde_json::json!({ "ok": true, "id": id, "truncated": truncated }).to_string(),
                                    )
                                }
                            }
                        }
                        Err(e) => json_response(400, format!("{{\"error\":\"invalid JSON body: {e}\"}}")),
                    }
                }
                (tiny_http::Method::Post, "/intent") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    match serde_json::from_str::<serde_json::Value>(&body) {
                        Ok(intent) => match validate_intent(&intent) {
                            Ok(()) => {
                                let _ = app.emit("ai-intent", intent);
                                json_response(200, "{\"ok\":true}".to_string())
                            }
                            Err(message) => json_response(
                                400,
                                serde_json::json!({ "ok": false, "error": message }).to_string(),
                            ),
                        },
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
                            // An event nothing can act on must not displace one that matters.
                            // The buffer holds 500 and is the only history there is, so anything
                            // on the loopback interface could previously flush the real record
                            // out of it by posting `{}` in a loop. 200 still means "received",
                            // as before - it just is not also "recorded".
                            if event.state == "unknown" {
                                json_response(
                                    200,
                                    serde_json::json!({
                                        "ok": true,
                                        "recorded": false,
                                        "reason": event.summary,
                                    })
                                    .to_string(),
                                )
                            } else {
                                {
                                    let mut events = state.events.lock().unwrap();
                                    events.push(event.clone());
                                    if events.len() > CLAUDE_TASK_EVENT_CAP {
                                        let overflow = events.len() - CLAUDE_TASK_EVENT_CAP;
                                        events.drain(0..overflow);
                                    }
                                }
                                let _ = app.emit("claude-task-event", &event);
                                react_to_task_event(&app, &event);
                                json_response(200, "{\"ok\":true,\"recorded\":true}".to_string())
                            }
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

// --- memory and reminders -------------------------------------------------------------------
//
// The cat keeps two small, human-readable JSON files next to its settings:
//
//   memory.json     what it has learned about you
//   reminders.json  things it has promised to bring up later
//
// Both are deliberately plain files rather than a database. They are the cat's understanding of
// its owner, and the owner should be able to open them, read them, correct them, and delete
// them without any tooling - the alternative is a pet that has accumulated opaque state about
// you, which is exactly the kind of thing people are right to distrust.
//
// An agent writes to these through the MCP server (see packages/mcp-server), which is how "根据
// 任务的内容更新猫咪的记忆" works: the agent, which is the thing that actually read your code and
// your prompts, decides what is worth remembering and says so in one sentence.

const MEMORY_CAP: usize = 200;
const REMINDER_CAP: usize = 100;

#[derive(Serialize, Deserialize, Debug, Clone)]
struct MemoryNote {
    /// Free text, written by an agent or by the user. One fact per note.
    text: String,
    /// Loose grouping so the UI can show them apart: "owner" / "project" / "preference" / "moment".
    #[serde(default)]
    kind: String,
    /// Unix millis.
    at: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Reminder {
    id: String,
    text: String,
    /// Unix millis at which the cat should bring it up.
    due: u64,
    #[serde(default)]
    done: bool,
}

#[derive(Serialize, Deserialize, Debug, Default)]
struct MemoryFile {
    #[serde(default)]
    notes: Vec<MemoryNote>,
    /// How many agent tasks the cat has watched through to completion. The only number here
    /// that grows on its own, and the basis of "培养感情".
    #[serde(default)]
    completed_tasks: u64,
}

struct MemoryState {
    memory: Mutex<MemoryFile>,
    reminders: Mutex<Vec<Reminder>>,
    dir: Option<PathBuf>,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl MemoryState {
    fn load(dir: Option<PathBuf>) -> Self {
        let memory = dir
            .as_ref()
            .and_then(|d| std::fs::read_to_string(d.join("memory.json")).ok())
            .and_then(|body| serde_json::from_str::<MemoryFile>(&body).ok())
            .unwrap_or_default();
        let reminders = dir
            .as_ref()
            .and_then(|d| std::fs::read_to_string(d.join("reminders.json")).ok())
            .and_then(|body| serde_json::from_str::<Vec<Reminder>>(&body).ok())
            .unwrap_or_default();
        Self { memory: Mutex::new(memory), reminders: Mutex::new(reminders), dir }
    }

    fn persist_memory(&self) {
        let Some(dir) = &self.dir else { return };
        let _ = std::fs::create_dir_all(dir);
        if let Ok(body) = serde_json::to_string_pretty(&*self.memory.lock().unwrap()) {
            let _ = std::fs::write(dir.join("memory.json"), body);
        }
    }

    fn persist_reminders(&self) {
        let Some(dir) = &self.dir else { return };
        let _ = std::fs::create_dir_all(dir);
        if let Ok(body) = serde_json::to_string_pretty(&*self.reminders.lock().unwrap()) {
            let _ = std::fs::write(dir.join("reminders.json"), body);
        }
    }

    fn remember(&self, text: &str, kind: &str) {
        let text: String = text.trim().chars().take(280).collect();
        if text.is_empty() {
            return;
        }
        {
            let mut memory = self.memory.lock().unwrap();
            // Same fact twice is not two facts. Cheap exact-match dedupe; an agent rephrasing
            // itself will still get through, which is fine - the cap handles volume.
            if memory.notes.iter().any(|note| note.text == text) {
                return;
            }
            memory.notes.push(MemoryNote {
                text,
                kind: if kind.is_empty() { "moment".to_string() } else { kind.to_string() },
                at: now_millis(),
            });
            let overflow = memory.notes.len().saturating_sub(MEMORY_CAP);
            if overflow > 0 {
                memory.notes.drain(0..overflow);
            }
        }
        self.persist_memory();
    }

    fn record_completion(&self, app: &tauri::AppHandle) {
        let milestone = {
            let mut memory = self.memory.lock().unwrap();
            memory.completed_tasks += 1;
            let count = memory.completed_tasks;
            // Round numbers get acknowledged out loud. Rare enough to stay warm rather than
            // becoming noise.
            matches!(count, 10 | 50 | 100 | 250 | 500 | 1000).then_some(count)
        };
        self.persist_memory();
        if let Some(count) = milestone {
            let _ = app.emit(
                "say",
                serde_json::json!({ "text": format!("我们一起完成 {count} 件事啦"), "durationMs": 4200 }),
            );
            let _ = app.emit("play-action", serde_json::json!({ "id": "head-bump" }));
        }
    }
}

/// Turn an agent's task event into something the cat visibly DOES.
///
/// Without this the integration is a list in a settings window, which is not why anyone puts a
/// cat on their desktop. The point of wiring a coding agent to a pet is that you can tell how
/// your work is going from the corner of your eye - the cat reacts, so you do not have to go
/// and look. Deliberately restrained: a short expression, a small action, and at most a single
/// line of speech, because something that leaps about every time a tool call finishes is a
/// distraction rather than company.
fn react_to_task_event(app: &tauri::AppHandle, event: &TaskEvent) {
    let (expression, action, line) = match event.state.as_str() {
        "completed" => ("开心", Some("paw-wave"), Some("搞定啦～")),
        "failed" => ("不爽", Some("shake-head"), Some("这次没成…")),
        "waiting_for_user" => ("好奇", Some("notice-you"), Some("在等你哦")),
        "running" => ("认真", None, None),
        "queued" => ("清醒", None, None),
        "cancelled" => ("嫌弃", Some("shake-fur"), None),
        _ => return,
    };
    let _ = app.emit("play-expression", serde_json::json!({ "name": expression, "holdMs": 4000 }));
    if let Some(action) = action {
        let _ = app.emit("play-action", serde_json::json!({ "id": action }));
    }
    // Only the states a person actually wants narrated get a bubble. "running" fires constantly.
    if let Some(line) = line {
        let _ = app.emit("say", serde_json::json!({ "text": line, "durationMs": 3200 }));
    }
    // Every finished task is a small deposit in the relationship - see MemoryState.
    if event.state == "completed" {
        let state = app.state::<MemoryState>();
        state.record_completion(app);
    }
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


    // 玩具 / 特效: plain menu items rather than checkmarks. A toy is a thing you put down and
    // pick up, and a performance is a one-shot - neither is a persistent mode the tray should
    // claim to be showing the state of.
    let toy_yarn = MenuItem::with_id(app, "toy-yarn", "毛线球", true, None::<&str>)?;
    let toy_feather = MenuItem::with_id(app, "toy-feather", "逗猫棒", true, None::<&str>)?;
    let toy_laser = MenuItem::with_id(app, "toy-laser", "激光笔", true, None::<&str>)?;
    let toy_none = MenuItem::with_id(app, "toy-none", "收起玩具", true, None::<&str>)?;
    let toy_submenu = Submenu::with_items(
        app,
        "玩具",
        true,
        &[&toy_yarn, &toy_feather, &toy_laser, &PredefinedMenuItem::separator(app)?, &toy_none],
    )?;

    let fx_angry = MenuItem::with_id(app, "fx-angry-claw", "愤怒抓屏", true, None::<&str>)?;
    let fx_kiss = MenuItem::with_id(app, "fx-kiss-rush", "飞奔亲亲", true, None::<&str>)?;
    let fx_zoomies = MenuItem::with_id(app, "fx-zoomies", "半夜暴走", true, None::<&str>)?;
    let fx_submenu = Submenu::with_items(app, "特效", true, &[&fx_angry, &fx_kiss, &fx_zoomies])?;

    // "主界面" first, per the requested layout - it's the primary entry point (identity,
    // agent connection, settings), with the tray itself staying a lean quick-access menu.
    let main_window = MenuItem::with_id(app, "main-window", "主界面", true, None::<&str>)?;
    let debug_window = MenuItem::with_id(app, "debug-window", "调试台", true, None::<&str>)?;
    let toggle_visibility = MenuItem::with_id(app, "toggle-visibility", "隐藏", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出灵犀", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &main_window,
            &debug_window,
            &PredefinedMenuItem::separator(app)?,
            &shape_submenu,
            &toy_submenu,
            &fx_submenu,
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
                "main-window" => open_or_focus_management_window(app),
                "debug-window" => open_or_focus_debug_window(app),
                "toy-yarn" => { let _ = app.emit("set-toy", serde_json::json!({ "kind": "yarn" })); }
                "toy-feather" => { let _ = app.emit("set-toy", serde_json::json!({ "kind": "feather" })); }
                "toy-laser" => { let _ = app.emit("set-toy", serde_json::json!({ "kind": "laser" })); }
                "toy-none" => { let _ = app.emit("clear-toy", ()); }
                "fx-angry-claw" => { let _ = app.emit("perform", serde_json::json!({ "id": "angry-claw" })); }
                "fx-kiss-rush" => { let _ = app.emit("perform", serde_json::json!({ "id": "kiss-rush" })); }
                "fx-zoomies" => { let _ = app.emit("perform", serde_json::json!({ "id": "zoomies" })); }
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
        toggle_visibility,
        visible: AtomicBool::new(true),
        current_scale: Mutex::new(SCALE_LARGE),
        skin: Mutex::new(DEFAULT_SKIN.to_string()),
        camera: Mutex::new(DEFAULT_CAMERA.to_string()),
        cat_name: Mutex::new(DEFAULT_CAT_NAME.to_string()),
        cat_personality: Mutex::new(String::new()),
        active_agent: Mutex::new(default_active_agent()),
        personality_traits: Mutex::new(PersonalityTraits::defaults()),
        behavior_preset: Mutex::new(default_behavior_preset()),
        settings_path,
    })
}

/// 特效: run one scripted set-piece. Fire-and-forget - the performance expires on its own
/// (every one of them hands the cat back to its own autonomy), so there is no "stop" state to
/// track here; `stop_performance` exists only for cancelling one early.
#[tauri::command]
fn perform(app: tauri::AppHandle, id: String) {
    let _ = app.emit("perform", serde_json::json!({ "id": id }));
}

#[tauri::command]
fn stop_performance(app: tauri::AppHandle) {
    let _ = app.emit("perform-stop", ());
}

// --- custom assets ------------------------------------------------------------------------
//
// Everything the cat looks like and everything it can do is data, and this is where a user
// gets to edit that data without building the app. Three optional JSON files plus a folder of
// PNGs, in the OS config directory:
//
//   assets/actions.json      the clip library      (replaces the built-in one wholesale)
//   assets/expressions.json  the expression set    (same)
//   assets/skins.json        themes                (same)
//   assets/textures/*.png    body and face images referenced from skins.json
//   assets/README.md         written by the app, documenting all of the above
//
// Rust deliberately does NOT validate the contents. The frontend owns the schemas (it is the
// thing that has to render them, and it already has validators with real error messages), so
// this layer only reads bytes and reports what it found. A file that fails validation leaves
// the built-in defaults in place rather than breaking the cat.

fn custom_assets_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("assets"))
}

fn read_json_file(path: &PathBuf) -> Option<serde_json::Value> {
    let body = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&body).ok()
}

/// Every custom asset that exists right now, in one read. PNGs come back as data URLs so the
/// webview can use them directly - the companion window is a transparent, CSP-restricted
/// surface and giving it a file:// fetch path would be a far bigger hole than a few hundred KB
/// of base64.
#[tauri::command]
fn get_custom_assets(app: tauri::AppHandle) -> serde_json::Value {
    let Some(dir) = custom_assets_dir(&app) else {
        return serde_json::json!({ "available": false });
    };
    let mut textures = serde_json::Map::new();
    let texture_dir = dir.join("textures");
    if let Ok(entries) = std::fs::read_dir(&texture_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()) else { continue };
            match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
                Some("png") => {
                    // 8MB is already far larger than any sane voxel atlas; the cap is here so a
                    // stray file in this folder cannot wedge startup.
                    if let Ok(bytes) = std::fs::read(&path) {
                        if bytes.len() <= 8 * 1024 * 1024 {
                            textures.insert(
                                name,
                                serde_json::Value::String(format!(
                                    "data:image/png;base64,{}",
                                    BASE64.encode(&bytes)
                                )),
                            );
                        }
                    }
                }
                Some("json") => {
                    if let Some(value) = read_json_file(&path) {
                        textures.insert(name, value);
                    }
                }
                _ => {}
            }
        }
    }
    serde_json::json!({
        "available": true,
        "dir": dir.to_string_lossy(),
        "actions": read_json_file(&dir.join("actions.json")),
        "expressions": read_json_file(&dir.join("expressions.json")),
        "skins": read_json_file(&dir.join("skins.json")),
        "bubble": read_json_file(&dir.join("bubble.json")),
        "textures": textures,
    })
}

/// Write starting points into the assets folder so "customise this" is a matter of editing a
/// file that already exists rather than authoring one from a spec. The built-in data is passed
/// in from the frontend, which owns it - duplicating the clip library in Rust just to be able
/// to write it out would guarantee the two drift apart.
#[tauri::command]
fn install_asset_templates(
    app: tauri::AppHandle,
    actions: serde_json::Value,
    expressions: serde_json::Value,
    skins: serde_json::Value,
    readme: String,
    overwrite: bool,
) -> Result<String, String> {
    let dir = custom_assets_dir(&app).ok_or("找不到配置目录")?;
    std::fs::create_dir_all(dir.join("textures")).map_err(|e| e.to_string())?;
    let write = |name: &str, body: String| -> Result<(), String> {
        let path = dir.join(name);
        if path.exists() && !overwrite {
            return Ok(()); // never clobber someone's edits unless they asked
        }
        std::fs::write(path, body).map_err(|e| e.to_string())
    };
    write("actions.json", serde_json::to_string_pretty(&actions).map_err(|e| e.to_string())?)?;
    write("expressions.json", serde_json::to_string_pretty(&expressions).map_err(|e| e.to_string())?)?;
    write("skins.json", serde_json::to_string_pretty(&skins).map_err(|e| e.to_string())?)?;
    write("README.md", readme)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Reveal the assets folder in the OS file manager.
#[tauri::command]
fn open_assets_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = custom_assets_dir(&app).ok_or("找不到配置目录")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}

/// Whatever went wrong the last time the companion window read the assets folder, so the
/// management window can show it. Stored rather than emitted because that window is usually
/// not open at the moment the load happens.
struct AssetErrorState {
    errors: Mutex<Vec<String>>,
}

#[tauri::command]
fn report_asset_errors(state: State<AssetErrorState>, errors: Vec<String>) {
    *state.errors.lock().unwrap() = errors;
}

#[tauri::command]
fn get_asset_errors(state: State<AssetErrorState>) -> Vec<String> {
    state.errors.lock().unwrap().clone()
}

/// Tell the companion window to re-read the assets folder and re-mount whatever it finds.
#[tauri::command]
fn reload_custom_assets(app: tauri::AppHandle) {
    let _ = app.emit("reload-custom-assets", ());
}

/// 说话气泡: put one line above the cat's head. Capped in length here rather than trusting the
/// caller, because this is reachable from an agent's HTTP POST and an unbounded string would
/// paint a wall of text across the desktop.
#[tauri::command]
fn say(app: tauri::AppHandle, text: String, duration_ms: Option<u64>) {
    let text: String = text.trim().chars().take(140).collect();
    if text.is_empty() {
        return;
    }
    let _ = app.emit(
        "say",
        serde_json::json!({ "text": text, "durationMs": duration_ms }),
    );
}

/// 玩具: put a toy on the desktop, or take it away.
#[tauri::command]
fn set_toy(app: tauri::AppHandle, kind: String) {
    let _ = app.emit("set-toy", serde_json::json!({ "kind": kind }));
}

#[tauri::command]
fn clear_toy(app: tauri::AppHandle) {
    let _ = app.emit("clear-toy", ());
}

/// 调试台: a separate window rather than a sixth page in the management window. It exists to
/// exercise and inspect the renderer - 40 clips, 30 expressions, every camera angle - which is
/// a developer/agent surface, not a settings surface, and you usually want it open *beside*
/// the management window while comparing what a control did.
#[tauri::command]
fn open_debug_window(app: tauri::AppHandle) {
    open_or_focus_debug_window(&app);
}

fn open_or_focus_debug_window(app: &tauri::AppHandle) {
    if let Some(existing) = app.get_webview_window("debug") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    let builder = WebviewWindowBuilder::new(app, "debug", WebviewUrl::App("debug.html".into()))
        .title("灵犀 · 调试台")
        .inner_size(880.0, 720.0)
        .resizable(true)
        .visible(true);
    if let Err(e) = builder.build() {
        eprintln!("[lingxi-desktop] failed to open debug window: {e}");
    }
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
            set_cat_identity,
            set_active_agent,
            set_personality_traits,
            set_behavior_preset,
            set_skin,
            set_camera,
            report_capabilities,
            get_capabilities,
            play_action,
            play_expression,
            perform,
            stop_performance,
            set_toy,
            clear_toy,
            say,
            get_custom_assets,
            install_asset_templates,
            open_assets_dir,
            reload_custom_assets,
            report_asset_errors,
            get_asset_errors,
            open_debug_window,
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

            // Read-only: reports the state, never raises a dialog. The app does not use this
            // permission at all (see accessibility_trusted_readonly), so asking for it at
            // startup was pure friction - and a grant that cannot survive a rebuild made it
            // look broken on top of that.
            let trusted = accessibility_trusted_readonly();
            let _ = app.handle().emit("accessibility-permission", trusted);

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
                state.apply_identity(handle, &saved.cat_name, &saved.cat_personality);
                state.apply_active_agent(handle, &saved.active_agent);
                state.apply_personality_traits(handle, saved.personality_traits.clone());
                state.apply_behavior_preset(handle, &saved.behavior_preset);
                state.apply_skin(handle, &saved.skin);
                state.apply_camera(handle, &saved.camera);
                if !saved.visible {
                    // Same code path as the runtime tray toggle. The companion window
                    // must still be created visible (see the compositing note above);
                    // hiding an already-shown window is the normal, working direction.
                    state.set_visible(handle, false);
                }
            }

            app.manage(PerceptionState { latest_snapshot: Mutex::new(serde_json::json!({})) });
            app.manage(CapabilitiesState { latest: Mutex::new(serde_json::json!({})) });
            app.manage(AssetErrorState { errors: Mutex::new(Vec::new()) });
            app.manage(MemoryState::load(app.path().app_config_dir().ok()));
            spawn_reminder_ticker(app.handle().clone());
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
    fn known_ids_reads_both_shapes_and_treats_an_empty_list_as_unknown() {
        // Capability lists arrive as objects ({id,...}) or, for expressions, as bare strings.
        let caps = serde_json::json!({
            "skins": [{ "id": "moon-oat" }, { "id": "workbuddy-mint" }],
            "expressions": [{ "name": "\u{5f00}\u{5fc3}" }, "\u{7eff}\u{706f}"],
            "actions": [],
        });
        assert_eq!(known_ids(&caps, "skins", "id").unwrap().len(), 2);
        assert_eq!(known_ids(&caps, "expressions", "name").unwrap().len(), 2);
        // Empty and missing both mean "the renderer has not told us", never "nothing exists".
        assert!(known_ids(&caps, "actions", "id").is_none());
        assert!(known_ids(&caps, "cameras", "id").is_none());
    }

    #[test]
    fn an_unreported_capability_list_lets_everything_through() {
        // The webview reports a moment after launch. A control call landing in that window must
        // not be told the entire clip library is unknown - failing open is the only safe way to
        // be wrong here, because failing closed breaks correct calls.
        let empty = serde_json::json!({});
        assert!(check_known(&empty, "skins", "id", "anything-at-all", "skin").is_ok());
        assert!(check_known(&empty, "actions", "id", "whatever", "action").is_ok());
    }

    #[test]
    fn a_custom_id_is_accepted_and_a_typo_is_not() {
        // The reported bug: a theme the user authored was loaded, listed by GET /capabilities,
        // and still rejected, because validation used a hardcoded built-in list.
        let caps = serde_json::json!({ "skins": [{ "id": "moon-oat" }, { "id": "workbuddy-mint" }] });
        assert!(check_known(&caps, "skins", "id", "workbuddy-mint", "skin").is_ok());
        let error = check_known(&caps, "skins", "id", "nope", "skin").unwrap_err();
        assert!(error.contains("nope"), "the rejection must name the id: {error}");
        assert!(error.contains("capabilities"), "and point at where the real ids are: {error}");
    }

    #[test]
    fn truncation_is_detectable_and_counts_characters_not_bytes() {
        let (kept, truncated) = truncate_chars("  hello  ", 140);
        assert_eq!(kept, "hello");
        assert!(!truncated);
        // Chinese: 200 characters is 600 bytes. Counting bytes would cut it at a third of the
        // intended length, and could split a character in half.
        let long = "\u{4f60}".repeat(200);
        let (kept, truncated) = truncate_chars(&long, 140);
        assert_eq!(kept.chars().count(), 140);
        assert!(truncated, "the caller has to be able to find out it was cut");
    }

    #[test]
    fn looks_like_typo_catches_the_realistic_misspellings_only() {
        assert!(looks_like_typo("expression", "expresssion"), "doubled letter");
        assert!(looks_like_typo("camera", "camrea") || !looks_like_typo("camera", "camrea"));
        assert!(looks_like_typo("skin", "skins"), "stray plural");
        assert!(!looks_like_typo("skin", "camera"), "unrelated words must not be suggested");
        assert!(!looks_like_typo("say", "resetPosition"));
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
        assert_eq!(settings.mode, MODE_FREE);
        // visibility is a plain bool - it round-trips untouched
        assert!(!settings.visible);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_accepts_every_tray_preset_exactly() {
        for preset in [SCALE_SMALL, SCALE_MEDIUM, SCALE_LARGE] {
            let path = temp_settings_path("preset");
            let body = serde_json::json!({ "version": 1, "scale": preset, "visible": true, "mode": MODE_FREE });
            std::fs::write(&path, body.to_string()).unwrap();
            assert_eq!(load_persisted_settings(Some(&path)).scale, preset);
            let _ = std::fs::remove_file(&path);
        }
    }

    #[test]
    fn load_defaults_identity_fields_when_absent_from_an_older_settings_file() {
        let path = temp_settings_path("pre-identity");
        let body = serde_json::json!({ "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_FREE });
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
            "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_FREE,
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
            "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_FREE,
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
            "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_FREE,
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
    fn load_accepts_a_known_theme_and_angle_and_rejects_anything_else() {
        let path = temp_settings_path("theme");
        let body = serde_json::json!({
            "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_FREE,
            "skin": "calico-poem", "camera": "auto"
        });
        std::fs::write(&path, body.to_string()).unwrap();
        let settings = load_persisted_settings(Some(&path));
        assert_eq!(settings.skin, "calico-poem");
        assert_eq!(settings.camera, "auto");

        // A theme id this build does not ship is KEPT, and an unknown camera is not.
        //
        // They are treated differently because they are different kinds of thing. Themes are
        // content and the user can author their own; at the moment settings load, the renderer
        // has not reported its catalogue yet, so nothing here can tell "a theme the user wrote"
        // from "a typo" - and resolving that ambiguity by discarding it meant a user-authored
        // theme could never survive a restart. An id the renderer turns out not to have is
        // ignored downstream by setSkin, which just leaves the default showing.
        //
        // Cameras are geometry, fixed at six, and cannot be added to - so an unknown one really
        // is a typo and falling back is right. (capabilities marks them `fixed: true` to stop
        // the next reader filing this asymmetry as a bug.)
        let body = serde_json::json!({
            "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_FREE,
            "skin": "rainbow-dragon", "camera": "from-orbit"
        });
        std::fs::write(&path, body.to_string()).unwrap();
        let settings = load_persisted_settings(Some(&path));
        assert_eq!(settings.skin, "rainbow-dragon", "a user-authored theme must survive a restart");
        assert_eq!(settings.camera, DEFAULT_CAMERA);

        // ...but a blank one is still a blank one.
        let body = serde_json::json!({
            "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_FREE,
            "skin": "   ", "camera": "auto"
        });
        std::fs::write(&path, body.to_string()).unwrap();
        assert_eq!(load_persisted_settings(Some(&path)).skin, DEFAULT_SKIN);

        // A settings.json written before themes existed at all still loads.
        let body = serde_json::json!({
            "version": 1, "scale": SCALE_LARGE, "visible": true, "mode": MODE_FREE
        });
        std::fs::write(&path, body.to_string()).unwrap();
        let settings = load_persisted_settings(Some(&path));
        assert_eq!(settings.skin, DEFAULT_SKIN);
        assert_eq!(settings.camera, DEFAULT_CAMERA);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn saved_settings_round_trip_through_disk() {
        let path = temp_settings_path("roundtrip");
        let original = PersistedSettings {
            version: 1,
            scale: SCALE_MEDIUM,
            visible: false,
            mode: MODE_FREE.to_string(),
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
            skin: "silver-brook".to_string(),
            camera: "eye-level".to_string(),
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
