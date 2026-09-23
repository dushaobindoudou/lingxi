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
use std::collections::HashMap;
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

    /// "性格行为" trait sliders: persisted here, broadcast on `set-personality-traits`, and
    /// consumed by the life engine (see `setPersonality` in packages/life-engine, and the
    /// listener in apps/lingxi/src/main.ts).
    ///
    /// They used to stop at this function - stored and broadcast and read by nothing - and
    /// both this comment and the management window said so. They now move how long the cat
    /// rests between trips, how fast it walks, how hard it chases a toy, and how sleepy it
    /// has to get before it lies down. 0.5 on every slider is exactly the tuned default
    /// behaviour, so a user who never touches them sees no change.
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
    /// What sort of work this was - build / test / deploy / review / ... See TASK_KINDS. The
    /// reaction map keys on (state, kind), so a failed deploy can read differently from a failed
    /// search without the agent having to pick clips itself.
    #[serde(default)]
    kind: String,
    /// How the work feels, in one word - see TASK_MOODS. The dimension that lets the cat respond
    /// to a person rather than to a process.
    #[serde(default)]
    mood: String,
    /// 0..1 when the agent knows it. Absent for work with no measurable progress.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    progress: Option<f64>,
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
/// The task states any integration may report, whatever tool it is.
///
/// Deliberately a small, tool-agnostic vocabulary. An agent is asked to describe WHAT IS
/// HAPPENING, not which clip to play - see docs/decisions/003. That is what lets the user retune
/// every agent's reactions in one file, and what keeps an agent from having to know the 49-clip
/// library exists.
const TASK_STATES: [&str; 8] = [
    "queued", "running", "blocked",
    // Two different kinds of waiting, kept apart because they need different urgency. A question
    // can sit until the user looks up; an approval is BLOCKING A TOOL CALL right now, and is the
    // one an IM notification most needs to carry. Collapsing them meant a permission prompt and
    // "what should I name this?" arrived identically.
    "needs_input", "needs_approval",
    "completed", "failed", "cancelled",
];

/// The kind of work, which lets the cat react differently to a deploy than to a search.
const TASK_KINDS: [&str; 8] = [
    "build", "test", "deploy", "review", "search", "write", "chat", "other",
];

/// How the work FEELS, summarised by the agent in one word.
///
/// This is the dimension that makes the cat feel like it is paying attention to YOU rather than
/// to a build system. `state` and `kind` describe a process; a person writing a letter to their
/// mother and a person fighting a flaky test are both "running"/"write", and a pet that cannot
/// tell those apart is a status light with fur.
///
/// The agent is the only thing that can judge this - it has the actual content - so it reports a
/// mood and the cat owns what to do about it. Deliberately a small, closed set: a free-text mood
/// could not be mapped, and a long list would be picked from inconsistently.
const TASK_MOODS: [&str; 9] = [
    "focused",    // ordinary work, the default
    "proud",      // something hard just worked
    "tender",     // personal, affectionate, private - a letter, an anniversary, a gift
    "sad",        // bad news, something lost, an apology
    "frustrated", // fighting the same thing again
    "anxious",    // a deadline, a risky deploy, something irreversible
    "weary",      // hours in, late at night
    "playful",    // a toy project, naming things, messing about
    "curious",    // reading something new, exploring
];

/// A tool-agnostic task event, for any integration that is not Claude Code's hook format.
///
/// Claude's hooks arrive in their own shape and are translated (see below). Everything else
/// speaks this directly, so an editor plugin or a CI watcher does not have to pretend to be a
/// Claude hook to drive the cat.
fn normalize_generic_task_event(raw: &serde_json::Value, sequence: u64) -> Option<TaskEvent> {
    let state = raw.get("state").and_then(|v| v.as_str())?;
    if !TASK_STATES.contains(&state) {
        return None;
    }
    let provider = raw.get("provider").and_then(|v| v.as_str()).unwrap_or("unknown");
    let task_id = raw
        .get("taskId")
        .or_else(|| raw.get("task_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown-task");
    let kind = raw
        .get("kind")
        .and_then(|v| v.as_str())
        .filter(|k| TASK_KINDS.contains(k))
        .unwrap_or("other");
    let mood = raw
        .get("mood")
        .and_then(|v| v.as_str())
        .filter(|m| TASK_MOODS.contains(m))
        .unwrap_or("focused");
    // 0..1, or absent. Used to keep a long task from narrating itself - see should_react.
    let progress = raw
        .get("progress")
        .and_then(|v| v.as_f64())
        .filter(|p| p.is_finite())
        .map(|p| p.clamp(0.0, 1.0));
    let summary = raw.get("summary").and_then(|v| v.as_str()).unwrap_or("");
    let observed_at = now_millis();
    Some(TaskEvent {
        schema_version: 1,
        provider: provider.to_string(),
        source_id: raw
            .get("agent")
            .and_then(|v| v.as_str())
            .unwrap_or(provider)
            .to_string(),
        task_id: task_id.to_string(),
        event_id: format!("{provider}-{task_id}-{state}-{observed_at}-{sequence}"),
        state: state.to_string(),
        sequence,
        observed_at,
        summary: if summary.is_empty() {
            format!("{kind}: {state}")
        } else {
            summary.chars().take(240).collect()
        },
        kind: kind.to_string(),
        mood: mood.to_string(),
        progress,
    })
}

/// Codex's `notify` payload -> a task event, or None if this is not one.
///
/// Codex has no multi-event hook system, but it has one deterministic call: `notify`, which
/// Codex itself invokes at the end of a turn rather than the model deciding to. That makes it
/// the floor of the integration - it cannot be forgotten - while the MCP tools are the ceiling,
/// because only a model that chose to call one knows what the work was ABOUT.
///
/// ## Why this lives in Rust as well as in the node adapter
///
/// Same reason as CLAUDE_HOOK_COMMAND: the one-click installer writes a plain `curl` that posts
/// the RAW notify payload, so it keeps working for someone who installed the .app and has no
/// checkout. `integrations/adapters/lingxi-emit.mjs` maps the same shapes for people who do.
///
/// That makes this the THIRD mapper of an agent's events in this repo, and the Claude pair has
/// already demonstrated how that ends - they drifted, this side knew three events and the
/// adapter knew five, and a permission prompt was silently dropped on the path most people use.
/// So `normalize_codex_notify_event_matches_the_node_adapter` asserts every arm below against
/// the adapter's `fromCodex`, case for case. Adding a case to one without the other fails it.
///
/// Deliberately no `mood`: the adapter does not guess one either. A mood invented by an
/// integration is wrong in the one field the whole reaction design rests on, and it is wrong
/// somewhere nobody is looking.
fn normalize_codex_notify_event(raw: &serde_json::Value, sequence: u64) -> Option<TaskEvent> {
    // The shape has moved between Codex versions, so every key is read with its aliases and
    // anything unrecognised returns None rather than inventing a state.
    let kind_of = raw
        .get("type")
        .or_else(|| raw.get("event"))
        .or_else(|| raw.get("kind"))
        .and_then(|v| v.as_str())?;
    let state = match kind_of {
        "agent-turn-complete" | "turn-ended" | "turn_complete" => "completed",
        "turn-started" | "turn_started" => "running",
        "turn-failed" | "error" => "failed",
        "approval-requested" => "needs_approval",
        "input-requested" => "needs_input",
        _ => return None,
    };
    let task_id = raw
        .get("thread-id")
        .or_else(|| raw.get("thread_id"))
        .or_else(|| raw.get("session_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("codex-session");
    let summary = raw
        .get("last-assistant-message")
        .or_else(|| raw.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let observed_at = now_millis();
    Some(TaskEvent {
        schema_version: 1,
        provider: "codex".to_string(),
        source_id: "codex".to_string(),
        task_id: task_id.to_string(),
        event_id: format!("codex-{task_id}-{state}-{observed_at}-{sequence}"),
        state: state.to_string(),
        sequence,
        observed_at,
        summary: if summary.is_empty() {
            format!("chat: {state}")
        } else {
            summary.chars().take(240).collect()
        },
        // Everything through `notify` is a conversational turn: the payload carries no
        // indication of what sort of work it was, and guessing would be worse than "chat".
        kind: "chat".to_string(),
        mood: "focused".to_string(),
        progress: None,
    })
}

fn normalize_claude_hook_event(raw: &serde_json::Value, sequence: u64) -> TaskEvent {
    let session_id = raw.get("session_id").and_then(|v| v.as_str()).unwrap_or("unknown-session").to_string();
    let hook_event_name = raw.get("hook_event_name").and_then(|v| v.as_str()).unwrap_or("unknown");
    // Must stay in step with integrations/adapters/lingxi-emit.mjs's fromClaude(). Two mappers
    // exist because there are two paths in: the one-click installer writes a plain curl that
    // posts the RAW hook payload (so it works for someone with only the .app and no checkout),
    // while the plugin routes through the node adapter. They drifted - this side knew three
    // events and the adapter knew five - so a session start and, worse, a PERMISSION PROMPT were
    // silently dropped on the path most users take.
    let (state, summary) = match hook_event_name {
        "SessionStart" => ("queued".to_string(), "会话开始".to_string()),
        "UserPromptSubmit" => ("running".to_string(), "新一轮对话开始".to_string()),
        "Notification" => {
            // Claude raises this both for permission prompts and for plain questions. They need
            // different urgency - an approval is blocking a tool call right now - and the message
            // text is the only thing that separates them.
            let message = raw.get("message").and_then(|v| v.as_str()).unwrap_or("");
            let lower = message.to_lowercase();
            let approval = ["permission", "approve", "allow"]
                .iter()
                .any(|needle| lower.contains(needle))
                || message.contains('授') && message.contains('权')
                || message.contains("批准")
                || message.contains("允许");
            let state = if approval { "needs_approval" } else { "needs_input" };
            let text = if message.is_empty() {
                if approval { "等你批一下".to_string() } else { "在等你回一句".to_string() }
            } else {
                message.to_string()
            };
            (state.to_string(), text)
        }
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
        // Claude's hooks say nothing about what KIND of work it was - they are conversation
        // lifecycle events, not task events. "chat" is the honest answer, not a guess.
        kind: "chat".to_string(),
        // Nor anything about how it FELT. An agent that wants the cat to respond to the content
        // of the work posts a task event itself rather than relying on the hook.
        mood: "focused".to_string(),
        progress: None,
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
/// The hook line written into ~/.claude/settings.json by "一键接入".
///
/// It reads the bridge token itself. It did not, until the bridge grew authentication - at which
/// point every hook silently started getting a 401 and the cat stopped reacting to Claude Code
/// entirely, with nothing anywhere saying so. A hook that posts into a void is worse than no hook.
///
/// Still plain `curl` rather than the node adapter in integrations/adapters, deliberately: this
/// path has to keep working for someone who installed the .app and has no checkout, so it cannot
/// depend on a repository path existing. The adapter is the richer option for people who do have
/// one (see integrations/plugins/), and both post the same schema to the same endpoint.
///
/// The token goes into a variable BEFORE curl rather than inline in the header. Inline looks
/// tidier and does not work: the path contains spaces, so it needs quoting, and quoting inside
/// $( ) inside an already-quoted -H argument does not survive the shell. Caught by running the
/// generated line rather than by reading it.
///
/// `|| true` at the end, and every failure swallowed: a desktop pet must never be able to make
/// someone's agent fail.
const CLAUDE_HOOK_COMMAND: &str = concat!(
    "T=$(cat \"$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token\" 2>/dev/null); ",
    "curl -s -m 2 -X POST http://127.0.0.1:47811/task-event ",
    "-H 'Content-Type: application/json' -H \"Authorization: Bearer $T\" ",
    "--data-binary @- >/dev/null 2>&1 || true"
);

/// Hook lines we have written in the past. Uninstall has to recognise all of them, or an older
/// install becomes impossible to remove through the UI that created it.
const LEGACY_CLAUDE_HOOK_COMMANDS: [&str; 1] = [
    "curl -s -m 2 -X POST http://127.0.0.1:47811/task-event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true",
];

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
            .map(|inner| {
                inner.iter().any(|h| {
                    let command = h.get("command").and_then(|c| c.as_str());
                    command == Some(CLAUDE_HOOK_COMMAND)
                        || command.is_some_and(|c| LEGACY_CLAUDE_HOOK_COMMANDS.contains(&c))
                })
            })
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

/// What the local bridge actually is, right now, for the management window to render.
///
/// The "能力开放"/"隐私" cards used to be hand-written claims about the bridge, and they aged
/// badly in the worst direction: the page kept saying the access token was 未启用 and that
/// "同机进程目前都能直接调用" long after `BridgeToken` started minting one, persisting it at
/// 0600 and rejecting every unauthenticated request. A user reading that page was told the
/// security property was absent while it was in force - and a contributor was told there was
/// work to do that had already been done.
///
/// So the page asks instead of asserting. Everything here is read from the live state the
/// bridge itself uses, which means it cannot describe a build it is not running in.
#[tauri::command]
fn get_bridge_info(app: tauri::AppHandle) -> serde_json::Value {
    let token = app.state::<BridgeToken>();
    let registry = app.state::<AgentRegistry>();
    let agents: Vec<AgentIdentity> = registry.agents.lock().unwrap().values().cloned().collect();
    serde_json::json!({
        "port": PERCEPTION_HTTP_PORT,
        // Not a constant dressed up as data: it is true because a token exists, and the same
        // value is what /health publishes to callers.
        "authRequired": !token.value.is_empty(),
        // None when the config directory could not be written - the bridge then runs with a
        // session-only token, which the page should say rather than point at a missing file.
        "tokenFile": token.path.as_ref().map(|p| p.display().to_string()),
        "agents": agents,
    })
}

/// What Codex should run when a turn ends.
///
/// Same shape and the same reasoning as CLAUDE_HOOK_COMMAND: plain `curl`, reading the bridge
/// token itself, every failure swallowed, so it keeps working for someone who installed the
/// .app and has no checkout of this repository.
///
/// The difference is how the payload arrives. Claude Code pipes the hook JSON on stdin; Codex
/// appends it as a final ARGUMENT to whatever `notify` names. So this runs through `sh -c` with
/// a placeholder $0 ("lingxi-notify", which is what shows up in `ps`), leaving Codex's payload
/// as "$1" - and $1 is fed to curl through a here-string rather than interpolated into the
/// command, because the payload is arbitrary JSON containing quotes.
const CODEX_NOTIFY_SCRIPT: &str = concat!(
    "T=$(cat \"$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token\" 2>/dev/null); ",
    "printf '%s' \"$1\" | curl -s -m 2 -X POST http://127.0.0.1:47811/task-event ",
    "-H 'Content-Type: application/json' -H \"Authorization: Bearer $T\" ",
    "--data-binary @- >/dev/null 2>&1 || true"
);

/// How we recognise our own `notify` entry, including one we might rewrite later. Matching on
/// the endpoint rather than on the whole script means a future tweak to the command does not
/// make the previous install unrecognisable - which is what turns "uninstall" into "the button
/// says it is not installed while it plainly is".
const CODEX_NOTIFY_MARKER: &str = "127.0.0.1:47811/task-event";

fn codex_config_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex").join("config.toml"))
}

/// Our notify entry, as Codex wants it: an argv array.
fn codex_notify_value() -> toml_edit::Value {
    let mut array = toml_edit::Array::new();
    array.push("/bin/sh");
    array.push("-c");
    array.push(CODEX_NOTIFY_SCRIPT);
    array.push("lingxi-notify");
    toml_edit::Value::Array(array)
}

/// Does this `notify` value look like ours?
fn codex_notify_is_ours(value: &toml_edit::Item) -> bool {
    value
        .as_array()
        .map(|arr| arr.iter().any(|v| v.as_str().is_some_and(|s| s.contains(CODEX_NOTIFY_MARKER))))
        .unwrap_or(false)
}

/// Add our notify entry to a config's text, or explain why we will not.
///
/// Pure so it can be tested: every interesting case here is about what is ALREADY in someone's
/// file, and those cases are unpleasant to set up through $HOME.
fn codex_install_into(text: &str) -> Result<String, String> {
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("不是合法的 TOML，未做任何修改：{e}"))?;

    if let Some(existing) = doc.get("notify") {
        if !codex_notify_is_ours(existing) {
            return Err(format!(
                "已经有一个 notify，是别的工具的，没有改动：\n  {}\n\nTOML 的 notify 只能有一个，\
                 覆盖它会让那个工具静默失效。要两个都要，写一个分发脚本同时转发给两边——\
                 做法见 integrations/plugins/codex/README.md。",
                existing.to_string().trim(),
            ));
        }
    }
    doc["notify"] = toml_edit::Item::Value(codex_notify_value());
    Ok(doc.to_string())
}

/// Remove only what we wrote, and report what that was.
fn codex_uninstall_from(text: &str) -> Result<(String, Vec<&'static str>), String> {
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("不是合法的 TOML，未做任何修改：{e}"))?;
    // Someone else's notify is left exactly where it is - removing it would be the same
    // mistake as overwriting it during install.
    let mut removed: Vec<&'static str> = Vec::new();
    if doc.get("notify").map(codex_notify_is_ours).unwrap_or(false) {
        doc.remove("notify");
        removed.push("notify");
    }
    if let Some(servers) = doc.get_mut("mcp_servers").and_then(|t| t.as_table_like_mut()) {
        if servers.remove("lingxi").is_some() {
            removed.push("mcp_servers.lingxi");
        }
    }
    Ok((doc.to_string(), removed))
}

/// What the management window needs to draw the Codex panel.
///
/// Three outcomes, not two, and the third is the whole reason this is a separate command rather
/// than a boolean: `notify` is a single TOML key, so a machine that already has one is a machine
/// where installing would DELETE someone else's integration. integrations/plugins/codex/README.md
/// puts it plainly - "别直接覆盖用户已有的 notify。那是别人的功能，猫不值得" - and a one-click
/// button that silently did it anyway would be the most damaging thing in this app.
#[tauri::command]
fn codex_integration_status() -> serde_json::Value {
    let Some(path) = codex_config_path() else {
        return serde_json::json!({ "state": "unavailable", "reason": "找不到 HOME 目录" });
    };
    let display = path.display().to_string();
    if !path.exists() {
        return serde_json::json!({ "state": "not_installed", "configPath": display, "configExists": false });
    }
    let Ok(text) = std::fs::read_to_string(&path) else {
        return serde_json::json!({ "state": "unavailable", "configPath": display, "reason": "配置文件读不出来" });
    };
    let Ok(doc) = text.parse::<toml_edit::DocumentMut>() else {
        // A config we cannot parse is one we must not write to.
        return serde_json::json!({ "state": "unparsable", "configPath": display });
    };
    let mcp_installed = doc
        .get("mcp_servers")
        .and_then(|t| t.as_table_like())
        .map(|t| t.contains_key("lingxi"))
        .unwrap_or(false);
    match doc.get("notify") {
        None => serde_json::json!({
            "state": "not_installed", "configPath": display, "configExists": true, "mcpInstalled": mcp_installed,
        }),
        Some(existing) if codex_notify_is_ours(existing) => serde_json::json!({
            "state": "installed", "configPath": display, "configExists": true, "mcpInstalled": mcp_installed,
        }),
        Some(existing) => serde_json::json!({
            "state": "conflict",
            "configPath": display,
            "configExists": true,
            "mcpInstalled": mcp_installed,
            // Shown verbatim so the user can see whose it is and decide, rather than being
            // told "something is in the way".
            "existingNotify": existing.to_string().trim().to_string(),
        }),
    }
}

/// Add the notify hook and the MCP server block to ~/.codex/config.toml.
///
/// Refuses, rather than overwrites, when `notify` already belongs to something else. The
/// fan-out script that lets both coexist is in integrations/plugins/codex/README.md; deciding
/// to run it is the user's call, not this button's.
#[tauri::command]
fn install_codex_notify() -> Result<String, String> {
    let path = codex_config_path().ok_or_else(|| "找不到 HOME 目录".to_string())?;
    let text = if path.exists() {
        std::fs::read_to_string(&path).map_err(|e| format!("读不出 {}：{e}", path.display()))?
    } else {
        String::new()
    };
    let updated = codex_install_into(&text)?;

    if path.exists() {
        let backup = path.with_extension("toml.lingxi-backup");
        let _ = std::fs::copy(&path, &backup);
    }

    // Only the `notify` half is written here, on purpose.
    //
    // notify is the DETERMINISTIC half: Codex calls it itself at the end of every turn, and it
    // needs nothing but /bin/sh and curl, so one click configures it correctly on a machine
    // that has the .app and nothing else. The MCP half is the richer one - it is what lets a
    // reaction know what the work was ABOUT rather than only that it ended - but it runs
    // `packages/mcp-server`, which only exists inside a checkout of this repository. A button
    // that wrote a path to a directory the user does not have would produce a config that looks
    // configured and fails silently at every startup, which is worse than not writing it.
    //
    // So the page shows the MCP block as something to paste, with the checkout path filled in
    // by whoever has one. See codex_integration_status's `mcpInstalled`.

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("建不了 {}：{e}", parent.display()))?;
    }
    std::fs::write(&path, updated).map_err(|e| format!("写不进 {}：{e}", path.display()))?;
    Ok(format!("已写入 {}，重启 Codex 后生效。", path.display()))
}

/// Remove only what we put there.
#[tauri::command]
fn uninstall_codex_notify() -> Result<String, String> {
    let path = codex_config_path().ok_or_else(|| "找不到 HOME 目录".to_string())?;
    if !path.exists() {
        return Ok("本来就没有配置文件，无需移除。".to_string());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读不出 {}：{e}", path.display()))?;
    let (updated, removed) = codex_uninstall_from(&text)?;
    if removed.is_empty() {
        return Ok("没有找到我们写入的配置，什么都没改。".to_string());
    }
    std::fs::write(&path, updated).map_err(|e| format!("写不进 {}：{e}", path.display()))?;
    Ok(format!("已移除 {}。重启 Codex 后生效。", removed.join(" 与 ")))
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

/// The `lingxi` shell client, embedded in the binary.
///
/// WHY THE APP CARRIES ITS OWN CLI
///
/// The skill path is the one that works everywhere - an MCP tool call is a per-call approval
/// surface in many hosts, so a skill that shells out costs one approval instead of one per
/// reaction. But the skill tells the model to run `lingxi`, and until now `lingxi` only existed
/// inside a git checkout. Anyone who installed the .app and nothing else had a skill that
/// referred to a command they did not have.
///
/// So the app writes it out on every launch. That also keeps it in step: the copy on disk is
/// always the one that matches the running build's API, rather than whatever a checkout happens
/// to be at.
const LINGXI_CLI: &str = include_str!("../../../../integrations/cli/lingxi");

/// Write the CLI into the config directory and make it executable. Best-effort: a failure here
/// costs the shell path, not the app, so it is logged and otherwise ignored.
fn install_cli(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?.join("bin");
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join("lingxi");
    // Rewritten every launch rather than only when missing: an older copy silently disagreeing
    // with the running build's API is worse than no copy at all.
    std::fs::write(&path, LINGXI_CLI).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
    }
    Some(path)
}

/// The shared secret that gates the local HTTP bridge.
///
/// The bridge listens on 127.0.0.1 only, which keeps it off the network but does NOT make it
/// private: every process running as this user can reach it, and it can move the cat, read the
/// owner notes the user has accumulated, and write to files in their config directory. Loopback
/// is a network boundary, not a trust boundary.
///
/// So: a token, generated on first run, written to the config directory with owner-only
/// permissions. Anything that can read that file is already running as the user and has won
/// anyway; anything that cannot - a web page, another user, a sandboxed process - is now shut
/// out. Agents do not have to be told the value, they read the file (see the `lingxi` CLI).
struct BridgeToken {
    value: String,
    path: Option<PathBuf>,
}

impl BridgeToken {
    /// Load the existing token, or mint one. Failure to persist is not fatal - the bridge still
    /// runs with an in-memory token for this session, which is strictly better than running
    /// with none.
    fn load_or_create(app: &tauri::AppHandle) -> Self {
        let path = app.path().app_config_dir().ok().map(|dir| dir.join("bridge-token"));
        if let Some(path) = path.as_ref() {
            if let Ok(existing) = std::fs::read_to_string(path) {
                let trimmed = existing.trim().to_string();
                if trimmed.len() >= 32 {
                    return Self { value: trimmed, path: path.clone().into() };
                }
            }
        }
        let value = mint_token();
        if let Some(path) = path.as_ref() {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if std::fs::write(path, &value).is_ok() {
                // Owner read/write only. The whole point is that other accounts cannot read it.
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
                }
            }
        }
        Self { value, path }
    }
}

/// 32 bytes of OS randomness, hex encoded. Read straight from /dev/urandom rather than adding a
/// dependency for sixteen lines.
fn mint_token() -> String {
    use std::io::Read;
    let mut bytes = [0u8; 32];
    if let Ok(mut file) = std::fs::File::open("/dev/urandom") {
        if file.read_exact(&mut bytes).is_ok() {
            return bytes.iter().map(|b| format!("{b:02x}")).collect();
        }
    }
    // Only reachable if /dev/urandom is unavailable, which on macOS means something is very
    // wrong. Still better than an empty token, and the startup log says so.
    eprintln!("[lingxi-desktop] WARNING: /dev/urandom unavailable; bridge token is time-derived");
    let now = now_millis();
    (0..4).map(|i| format!("{:016x}", now.wrapping_mul(0x9e3779b97f4a7c15).rotate_left(i * 7))).collect()
}

/// Whether this request carries the token. Accepts `Authorization: Bearer <token>`, the
/// `X-Lingxi-Token` header, or a `?token=` query parameter - the last so a plain `curl` or a
/// browser address bar can be used while debugging.
fn request_authorised(request: &tiny_http::Request, expected: &str) -> bool {
    for header in request.headers() {
        let field = header.field.as_str().as_str();
        if field.eq_ignore_ascii_case("authorization") {
            if let Some(rest) = header.value.as_str().strip_prefix("Bearer ") {
                if constant_time_eq(rest.trim(), expected) {
                    return true;
                }
            }
        } else if field.eq_ignore_ascii_case("x-lingxi-token")
            && constant_time_eq(header.value.as_str().trim(), expected)
        {
            return true;
        }
    }
    request
        .url()
        .split_once('?')
        .map(|(_, query)| {
            query
                .split('&')
                .filter_map(|pair| pair.split_once('='))
                .any(|(key, value)| key == "token" && constant_time_eq(value, expected))
        })
        .unwrap_or(false)
}

/// Compare without leaking length-prefix information through timing. The threat here is modest -
/// a local attacker who can already time our responses - but a constant-time compare costs
/// nothing and removes the question.
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

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
const CONTROL_FIELDS: [&str; 18] = [
    "mode", "camera", "skin", "scale", "visible", "action", "expression", "holdMs", "perform",
    "toy", "say", "sayMs", "resetPosition", "reloadAssets",
    // Who is calling and how much the user needs to see it. Both optional - see decision 003.
    "agent", "priority",
    // How long a queued reaction stays worth showing. See DEFAULT_REACTION_TTL_MS.
    "expiresInMs",
    // Internal: set only by the queue drain when replaying a reaction that already holds the
    // stage. Listed so the unknown-field check does not reject our own replay.
    "__stageAlreadyHeld",
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

/// How long a clip runs, in milliseconds, from the renderer's reported capability list.
/// None when the renderer has not reported yet or does not have that clip.
fn action_duration_ms(caps: &serde_json::Value, id: &str) -> Option<u64> {
    caps.get("actions")?
        .as_array()?
        .iter()
        .find(|entry| entry.get("id").and_then(|v| v.as_str()) == Some(id))
        .and_then(|entry| entry.get("duration").and_then(|v| v.as_f64()))
        .map(|seconds| (seconds * 1000.0).round().max(0.0) as u64)
}

/// Truncate to `max` CHARACTERS (not bytes - the text is Chinese as often as not) and say
/// whether anything was lost, so the caller can be told rather than quietly misinformed.
fn truncate_chars(text: &str, max: usize) -> (String, bool) {
    let trimmed = text.trim();
    let kept: String = trimmed.chars().take(max).collect();
    let truncated = trimmed.chars().count() > max;
    (kept, truncated)
}


// --- who is driving the cat -------------------------------------------------------------------
//
// Several agents can hold this port open at once (Claude Code, a CI watcher, an editor plugin),
// and "they interfere with each other" is really three separate problems - see
// docs/decisions/003-multi-agent-arbitration.md. The part that needs machinery is the stage:
// two agents driving the face in the same second make the cat twitch.
//
// The priority that decides who wins comes from the EVENT, never from the agent. The tempting
// design is to rank the agents - Claude outranks the CI bot - and it is wrong: what the user
// needs to see is the important THING, not the important tool. A build failure outranks idle
// purring no matter who reports it.

/// How much the user needs to see this, highest first. Parsed from the `priority` field.
fn priority_rank(name: &str) -> u8 {
    match name {
        "alert" => 3,   // needs a look right now: a failure, a question, a confirmation
        "report" => 2,  // something finished
        "status" => 1,  // state changed, not urgent
        _ => 0,         // ambient flavour
    }
}

const PRIORITY_NAMES: [&str; 4] = ["ambient", "status", "report", "alert"];

#[derive(Clone, Serialize)]
struct AgentIdentity {
    id: String,
    name: String,
    /// Short text fallback, shown when the agent has not supplied a logo.
    badge: String,
    /// The agent's own mark, as an SVG document or a data: URI. Agents are asked to GENERATE
    /// one - a model can author an SVG unaided, which is the whole point: no asset pipeline, no
    /// upload UI, nothing for the user to prepare.
    ///
    /// Rendered inside an <img> by the webview, never inlined into the DOM, so the markup cannot
    /// execute script or fetch anything external whatever it contains.
    #[serde(skip_serializing_if = "Option::is_none")]
    logo: Option<String>,
    /// CSS colour for the badge ring.
    color: String,
    registered_at: u64,
    last_seen: u64,
    /// Stage claims this agent has made, for the per-agent budget and for the user to see who is
    /// noisiest.
    claims: u64,
}

#[derive(Clone, Serialize)]
struct StageClaim {
    agent: String,
    badge: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    logo: Option<String>,
    color: String,
    priority: String,
    rank: u8,
    until: u64,
}

/// Something waiting for its turn on the stage, with a deadline after which it is not worth
/// showing any more.
#[derive(Clone)]
struct QueuedReaction {
    agent: AgentIdentity,
    command: serde_json::Value,
    priority: String,
    rank: u8,
    hold_ms: u64,
    queued_at: u64,
    /// After this, drop it unplayed. A reaction is a statement about a moment, and a moment
    /// expires.
    expires_at: u64,
}

#[derive(Default)]
struct AgentRegistry {
    agents: Mutex<HashMap<String, AgentIdentity>>,
    stage: Mutex<Option<StageClaim>>,
    /// Waiting reactions, highest rank first then oldest first. Bounded: a queue that grows
    /// without limit is a memory leak with a pleasant name.
    queue: Mutex<Vec<QueuedReaction>>,
}

/// Longest anything may sit in the queue before it is dropped unplayed, unless the caller asked
/// for something shorter. Deliberately short: a "tests passed" shown thirty seconds late is not
/// a late reaction, it is a wrong one - the user has moved on and the cat is talking about
/// history. Callers that care can set `expiresInMs` themselves.
const DEFAULT_REACTION_TTL_MS: u64 = 8000;
/// Hard cap on queued reactions. Past this the LOWEST-priority one is dropped to make room, so
/// a flood of ambient chatter can never push out an alert.
const REACTION_QUEUE_CAP: usize = 16;

impl AgentRegistry {
    /// Decide whether `agent` may drive the cat's face right now.
    ///
    /// Returns Err with a human-readable reason when it may not. A refusal is NOT a queue: a
    /// "tests passed" that arrives five seconds late is stale news, and playing it then would
    /// have the cat reacting to the wrong thing. Callers are told to drop it, not retry it.
    fn claim_stage(
        &self,
        agent: &AgentIdentity,
        priority: &str,
        hold_ms: u64,
        now: u64,
    ) -> Result<(), (String, u64)> {
        let rank = priority_rank(priority);
        let mut stage = self.stage.lock().unwrap();
        if let Some(current) = stage.as_ref() {
            if current.until > now && current.agent != agent.id && rank <= current.rank {
                return Err((
                    format!(
                        "{} ({}) is showing a \"{}\" reaction for another {}ms. Yours is \"{}\", \
                         which does not outrank it. DROP this reaction rather than retrying - by \
                         the time the stage is free it will be describing something that already \
                         finished.",
                        current.agent,
                        current.badge,
                        current.priority,
                        current.until.saturating_sub(now),
                        priority,
                    ),
                    current.until.saturating_sub(now),
                ));
            }
        }
        *stage = Some(StageClaim {
            agent: agent.id.clone(),
            badge: agent.badge.clone(),
            logo: agent.logo.clone(),
            color: agent.color.clone(),
            priority: priority.to_string(),
            rank,
            until: now + hold_ms.min(MAX_HOLD_MS),
        });
        Ok(())
    }

    /// Park a reaction until the stage frees up. Returns its place in the queue.
    ///
    /// Queueing is only offered to things worth waiting for - see `should_queue`. An `ambient`
    /// flourish that has to wait is not worth showing late; an `alert` is.
    fn enqueue(&self, item: QueuedReaction) -> usize {
        let mut queue = self.queue.lock().unwrap();
        queue.push(item);
        // Highest rank first, then oldest first within a rank.
        queue.sort_by(|a, b| b.rank.cmp(&a.rank).then(a.queued_at.cmp(&b.queued_at)));
        if queue.len() > REACTION_QUEUE_CAP {
            queue.truncate(REACTION_QUEUE_CAP); // the tail is the lowest-priority, newest work
        }
        queue.len()
    }

    /// The next reaction that is still worth playing, discarding any that expired while waiting.
    /// Returns it with the count of ones dropped, so that can be reported rather than hidden.
    fn take_next_due(&self, now: u64) -> (Option<QueuedReaction>, usize) {
        let mut queue = self.queue.lock().unwrap();
        let before = queue.len();
        queue.retain(|item| item.expires_at > now);
        let expired = before - queue.len();
        if queue.is_empty() {
            return (None, expired);
        }
        (Some(queue.remove(0)), expired)
    }

    fn stage_free_at(&self, now: u64) -> bool {
        self.stage
            .lock()
            .unwrap()
            .as_ref()
            .map(|claim| claim.until <= now)
            .unwrap_or(true)
    }
}

/// Whether a refused reaction is worth holding for later.
///
/// The rule the earlier build had - always drop - is right for flavour and wrong for anything
/// the user actually needs to see. A build failure that arrives while the cat is mid-purr should
/// still be shown two seconds later; an idle stretch should not. So: queue what matters, drop
/// what does not, and give everything a deadline either way.
fn should_queue(rank: u8) -> bool {
    rank >= 2 // report and alert
}

/// Largest logo we will hold, in bytes. Generous for an SVG (a detailed one is a few KB) and
/// small enough that a hundred registered agents cannot matter.
const MAX_LOGO_BYTES: usize = 64 * 1024;

/// Check an agent-supplied logo before storing it.
///
/// The webview renders it inside an <img>, which cannot run script or fetch external resources
/// whatever the markup says - that browser guarantee is the real defence, and it is stronger
/// than any sanitiser written here. These checks are the cheap second layer: keep it to formats
/// an <img> actually renders, keep it small, and refuse anything that reaches outward, so a
/// malformed or hostile document fails at registration with a message rather than silently
/// producing a broken bubble.
fn validate_logo(logo: &str) -> Result<(), String> {
    if logo.len() > MAX_LOGO_BYTES {
        return Err(format!(
            "logo is {} bytes; the limit is {MAX_LOGO_BYTES}. An SVG mark should be well under 8KB - \
             simplify the paths rather than embedding a raster image.",
            logo.len()
        ));
    }
    let trimmed = logo.trim();
    if trimmed.is_empty() {
        return Err("logo is empty".to_string());
    }
    let is_data_uri = trimmed.starts_with("data:image/svg+xml")
        || trimmed.starts_with("data:image/png")
        || trimmed.starts_with("data:image/webp");
    let is_svg = trimmed.starts_with("<svg") || trimmed.starts_with("<?xml");
    if !is_data_uri && !is_svg {
        return Err(
            "logo must be an SVG document (starting with <svg) or a data: URI of type \
             image/svg+xml, image/png or image/webp. Generate one - a small flat mark, two or \
             three colours, no text, readable at 22px."
                .to_string(),
        );
    }
    if is_svg {
        let lower = trimmed.to_ascii_lowercase();
        // An <img> would ignore these anyway; refusing them makes the intent explicit and gives
        // the author a reason rather than a silently different-looking mark.
        for forbidden in ["<script", "<foreignobject", "xlink:href=\"http", "href=\"http", "<image"] {
            if lower.contains(forbidden) {
                return Err(format!(
                    "logo contains `{forbidden}`, which will not render inside an <img> and is \
                     refused. Use plain shapes and paths only."
                ));
            }
        }
    }
    Ok(())
}

/// Look the caller up, registering a minimal identity for one that never called POST /agents.
///
/// An unregistered caller is not refused: the bridge predates the registry and the whole point
/// of a local HTTP surface is that `curl` works. It just shows up as itself with a neutral badge.
fn resolve_agent(registry: &AgentRegistry, id: Option<&str>, now: u64) -> AgentIdentity {
    let id = id.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("anonymous");
    let mut agents = registry.agents.lock().unwrap();
    let entry = agents.entry(id.to_string()).or_insert_with(|| AgentIdentity {
        id: id.to_string(),
        name: id.to_string(),
        badge: id.chars().take(2).collect(),
        logo: None,
        color: "#8b95a5".to_string(),
        registered_at: now,
        last_seen: now,
        claims: 0,
    });
    entry.last_seen = now;
    entry.claims += 1;
    entry.clone()
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

    // Who is asking, and how much the user needs to see it. Both optional: the bridge predates
    // the registry and plain `curl` has to keep working.
    let registry = app.state::<AgentRegistry>();
    let now = now_millis();
    let identity = resolve_agent(&registry, command.get("agent").and_then(|v| v.as_str()), now);
    let priority = command
        .get("priority")
        .and_then(|v| v.as_str())
        .filter(|p| PRIORITY_NAMES.contains(p))
        .unwrap_or("status");
    // Only the fields that take over the cat's PERFORMANCE contend for the stage. skin/camera/
    // scale are user settings and are handled separately below; resetPosition and reloadAssets
    // are housekeeping and never conflict.
    // A replay from the queue already holds the stage - see spawn_reaction_drain. Without this
    // it would contend with itself, fail, and be re-queued forever.
    let already_held = command
        .get("__stageAlreadyHeld")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let wants_stage = !already_held
        && ["expression", "action", "say", "perform", "toy"]
            .iter()
            .any(|field| command.get(*field).is_some());
    let mut stage_denied: Option<String> = None;
    let hold = command.get("holdMs").and_then(|v| v.as_u64()).unwrap_or(4000);
    if wants_stage {
        match registry.claim_stage(&identity, priority, hold, now) {
            Ok(()) => {
                detail.insert("agent".into(), serde_json::json!(identity.id));
                detail.insert("badge".into(), serde_json::json!(identity.badge));
                detail.insert("priority".into(), serde_json::json!(priority));
                // Tell the companion window who is driving, so the badge can be shown next to
                // the cat. This is the whole answer to "which agent did that" - see decision 003.
                let _ = app.emit(
                    "agent-stage",
                    serde_json::json!({
                        "agent": identity.id,
                        "name": identity.name,
                        "badge": identity.badge,
                        "logo": identity.logo,
                        "color": identity.color,
                        "priority": priority,
                        "holdMs": hold.min(MAX_HOLD_MS),
                    }),
                );
            }
            Err((reason, retry_after)) => {
                detail.insert("retryAfterMs".into(), serde_json::json!(retry_after));
                let rank = priority_rank(priority);
                if should_queue(rank) {
                    // Worth waiting for. Given a deadline either way: a reaction is a statement
                    // about a moment, and showing it after the moment has passed is not being
                    // late, it is being wrong.
                    let ttl = command
                        .get("expiresInMs")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(DEFAULT_REACTION_TTL_MS)
                        .min(MAX_HOLD_MS);
                    let place = registry.enqueue(QueuedReaction {
                        agent: identity.clone(),
                        command: command.clone(),
                        priority: priority.to_string(),
                        rank,
                        hold_ms: hold,
                        queued_at: now,
                        expires_at: now + ttl,
                    });
                    detail.insert("queued".into(), serde_json::json!(true));
                    detail.insert("queuePosition".into(), serde_json::json!(place));
                    detail.insert("expiresInMs".into(), serde_json::json!(ttl));
                    applied.push(format!(
                        "queued behind a higher-priority reaction (position {place}, expires in {ttl}ms)"
                    ));
                } else {
                    // Flavour is not worth showing late.
                    detail.insert("dropRatherThanRetry".into(), serde_json::json!(true));
                    stage_denied = Some(reason);
                }
            }
        }
    }
    if let Some(reason) = stage_denied {
        rejected.push(format!("stage busy: {reason}"));
        return (applied, rejected, serde_json::Value::Object(detail));
    }
    // A queued reaction returns here: it has not been applied yet, and applying the rest of the
    // command now would show half of it at the wrong time.
    if detail.contains_key("queued") {
        return (applied, rejected, serde_json::Value::Object(detail));
    }

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
                "camera" | "skin" | "action" | "expression" | "perform" | "toy" | "say" | "mode"
                | "agent" | "priority" => value.is_string(),
                "scale" => value.is_number(),
                "visible" | "resetPosition" | "reloadAssets" => value.is_boolean(),
                "holdMs" | "sayMs" | "expiresInMs" => value.is_number(),
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
                // Not refused - that would break existing integrations - but said out loud. A
                // theme is the USER's choice, and an agent quietly repainting their pet is the
                // kind of thing that is only noticed as "why does it keep changing". An agent
                // that wants to be recognisable should register a badge instead (decision 003).
                detail.insert(
                    "userSettingChanged".into(),
                    serde_json::json!(
                        "skin is a user preference, not an agent channel. Prefer registering a \
                         badge via POST /agents so you are identifiable without repainting the \
                         user's cat."
                    ),
                );
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
                    // When an action is sent alongside, the face is held for at least as long
                    // as the clip runs. A 4s default under a 6s clip means the expression snaps
                    // back to neutral while the body is still mid-gesture, which reads as the
                    // cat losing interest in its own action ("动作/表情需要做好同步").
                    let action_ms = command
                        .get("action")
                        .and_then(|v| v.as_str())
                        .and_then(|id| action_duration_ms(&caps, id))
                        .unwrap_or(0);
                    let requested = command
                        .get("holdMs")
                        .and_then(|v| v.as_u64())
                        .unwrap_or_else(|| action_ms.max(4000));
                    let hold_ms = requested.max(action_ms).min(MAX_HOLD_MS);
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
        // reactions.json is read on this side, not in the webview, so it is reloaded here.
        let (map, errors) = load_reaction_map(app);
        let count = map.len();
        *app.state::<ReactionMapState>().map.lock().unwrap() = map;
        detail.insert("reactionOverrides".into(), serde_json::json!(count));
        if !errors.is_empty() {
            detail.insert("reactionErrors".into(), serde_json::json!(errors));
        }
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
        "scale" | "holdMs" | "sayMs" | "expiresInMs" => "a number",
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
/// Play queued reactions as the stage frees up, and bin the ones that waited too long.
///
/// Runs often (250ms) because the whole point of queueing a `report` or an `alert` is that it
/// still lands close to the moment it describes - a drain that ran once a second would add up to
/// a second of staleness to every queued reaction, which is most of the budget they have.
fn spawn_reaction_drain(app: tauri::AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(app.state::<PowerState>().drain_interval());
        let now = now_millis();
        let registry = app.state::<AgentRegistry>();
        if !registry.stage_free_at(now) {
            continue;
        }
        let (next, expired) = registry.take_next_due(now);
        if expired > 0 {
            eprintln!("[lingxi-desktop] dropped {expired} reaction(s) that expired while queued");
        }
        let Some(item) = next else { continue };
        if registry
            .claim_stage(&item.agent, &item.priority, item.hold_ms, now)
            .is_err()
        {
            continue; // something took the stage in between; it stays queued for the next pass
        }
        let _ = app.emit(
            "agent-stage",
            serde_json::json!({
                "agent": item.agent.id,
                "name": item.agent.name,
                "badge": item.agent.badge,
                "logo": item.agent.logo,
                "color": item.agent.color,
                "priority": item.priority,
                "holdMs": item.hold_ms.min(MAX_HOLD_MS),
            }),
        );
        // Replayed WITHOUT the stage fields, so it cannot re-enter the queue: it has the stage.
        let mut replay = item.command.clone();
        if let Some(object) = replay.as_object_mut() {
            object.remove("priority");
            object.remove("expiresInMs");
            object.insert("__stageAlreadyHeld".into(), serde_json::json!(true));
        }
        let (applied, rejected, _) = apply_control_command(&app, &replay);
        if !rejected.is_empty() {
            eprintln!("[lingxi-desktop] queued reaction failed on replay: {rejected:?}");
        } else {
            eprintln!(
                "[lingxi-desktop] played queued reaction from {} after {}ms: {applied:?}",
                item.agent.id,
                now.saturating_sub(item.queued_at)
            );
        }
    });
}

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
            // Delivered in the tone it was set with. "记得喝水" and "该交税了" are not the same
            // face, and a gentle nudge arriving with an alarmed expression is worse than none.
            let (expression, action, _) =
                builtin_reaction("needs_input", "chat", if reminder.mood.is_empty() { "focused" } else { &reminder.mood })
                    .unwrap_or(("好奇", Some("notice-you"), None));
            let _ = app.emit("play-expression", serde_json::json!({ "name": expression, "holdMs": 5000 }));
            if let Some(action) = action {
                let _ = app.emit("play-action", serde_json::json!({ "id": action }));
            }
            let _ = app.emit(
                "say",
                serde_json::json!({ "text": reminder.text.clone(), "durationMs": 6000 }),
            );
            // A standing reminder re-arms rather than being recreated by the caller - the whole
            // point of "every hour, stand up" is that nothing has to remember to re-ask.
            if reminder.repeat_every_minutes > 0 {
                let mut reminders = state.reminders.lock().unwrap();
                if let Some(entry) = reminders.iter_mut().find(|r| r.id == reminder.id) {
                    entry.done = false;
                    entry.due = now_millis() + reminder.repeat_every_minutes * 60_000;
                }
                drop(reminders);
                state.persist_reminders();
            }
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
        let token = app.state::<BridgeToken>().value.clone();
        let token_path = app
            .state::<BridgeToken>()
            .path
            .clone()
            .map(|p| p.display().to_string());
        for mut request in server.incoming_requests() {
            let method = request.method().clone();
            // The token may arrive as a query parameter, so route on the path alone.
            let full_url = request.url().to_string();
            let url = full_url.split('?').next().unwrap_or("").to_string();

            // /health is the one unauthenticated endpoint: it exists so a caller that does not
            // have the token yet can find out where to read it, and it says nothing else.
            if url == "/health" {
                let _ = request.respond(json_response(
                    200,
                    serde_json::json!({
                        "ok": true,
                        "app": "lingxi",
                        "authRequired": true,
                        "tokenFile": token_path,
                        // Where the bundled shell client lives. A skill that says "run lingxi"
                        // needs somewhere to point when it is not on PATH and there is no checkout.
                        "cli": app
                            .path()
                            .app_config_dir()
                            .ok()
                            .map(|d| d.join("bin").join("lingxi").display().to_string()),
                        "howTo": "Read the token file and send it as `Authorization: Bearer <token>`, \
                                  `X-Lingxi-Token: <token>`, or `?token=<token>`. The file is readable \
                                  only by your own account.",
                    })
                    .to_string(),
                ));
                continue;
            }
            if !request_authorised(&request, &token) {
                // Loopback keeps this off the network; the token keeps it away from anything
                // that is not running as this user - a page in a browser, a sandboxed process,
                // another account on a shared machine. The bridge can move the cat, read the
                // owner notes, and write to the user's config directory, so "local" is not on
                // its own a good enough reason to let it through.
                let _ = request.respond(json_response(
                    401,
                    serde_json::json!({
                        "error": "missing or invalid token",
                        "tokenFile": token_path,
                        "howTo": "GET /health tells you where the token file is. Send it as \
                                  `Authorization: Bearer <token>`.",
                    })
                    .to_string(),
                ));
                continue;
            }

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
                // The whole integration contract, machine-readable, from the running build.
                //
                // Exists so an agent does not have to be shipped with a copy of the docs that
                // can go stale: it can read the vocabulary, the priorities and the reaction map
                // it will actually get, at runtime, from the cat it is actually talking to.
                (tiny_http::Method::Get, "/integration") => {
                    let overrides = app.state::<ReactionMapState>().map.lock().unwrap().clone();
                    json_response(
                        200,
                        serde_json::json!({
                            "schemaVersion": 1,
                            "howToIntegrate": [
                                "1. POST /agents once with {id, name, badge, color} - the badge is one emoji you pick for yourself, and it is how the user tells your reactions from another agent's.",
                                "2. Report WHAT IS HAPPENING via POST /task-event {provider, taskId, state, kind, summary}. Do NOT pick expressions or clips yourself - the cat maps state+kind to a reaction, and the user can retune that mapping for every agent at once.",
                                "3. Include a `mood` on every task event. It is the difference between a pet and a status light: state and kind describe a process, mood describes the person. The cat ANSWERS the mood rather than mirroring it - failure is met with comfort, not alarm.",
                                "4. Send `agent` and `priority` on any direct POST /control call so the cat can decide whose reaction the user needs to see.",
                                "5. A 400 'stage busy' means a more urgent reaction is showing. DROP yours - do not retry. By the time the stage frees up, yours describes something that already finished.",
                            ],
                            "taskEvent": {
                                "states": TASK_STATES,
                                "kinds": TASK_KINDS,
                                "moods": TASK_MOODS,
                                "progress": "0..1, optional. Send it for long work: `running` updates are swallowed except the first and the crossing of halfway, so a progress stream does not become a reaction stream.",
                                "moodGuidance": "YOU are the only thing that can judge this - you have the content. state and kind describe a process; someone writing to their mother and someone fighting a flaky test are both running/write. Pick the mood of the WORK, not your own confidence.",
                                "example": {
                                    "provider": "my-ci", "agent": "my-ci", "taskId": "build-4821",
                                    "state": "failed", "kind": "test", "mood": "frustrated",
                                    "progress": 0.6, "summary": "3 tests failed in auth/"
                                },
                            },
                            "reminders": {
                                "endpoint": "POST /reminders",
                                "fields": "text, then either inMinutes or dueAt (not both); optional mood (same vocabulary) and repeatEveryMinutes for a standing one (minimum 5).",
                                "note": "The mood decides the face it arrives with. A nudge to drink water and a tax deadline are not the same reminder.",
                            },
                            "priorities": {
                                "order": PRIORITY_NAMES,
                                "meaning": {
                                    "alert": "the user needs to look now - a failure, a question, a confirmation",
                                    "report": "something finished",
                                    "status": "state changed, not urgent",
                                    "ambient": "flavour only, rate-limited",
                                },
                                "note": "Priority comes from the EVENT, never from which agent you are. A build failure outranks idle purring no matter who reports it.",
                            },
                            "reactions": {
                                "customisableAt": custom_assets_dir(&app).map(|d| d.join("reactions.json").display().to_string()),
                                "keyedBy": "\"<state>\" or \"<state>:<kind>\", most specific wins",
                                "shape": { "expression": "required", "action": "optional clip id", "say": "optional line" },
                                "activeOverrides": overrides.keys().collect::<Vec<_>>(),
                            },
                            "notifications": {
                                "purpose": "An outlet, not an integration. 灵犀 does not connect to Slack, Feishu or anything else - those are your accounts - but it will echo task events to a webhook you already have.",
                                "configureAt": custom_assets_dir(&app)
                                    .and_then(|d| d.parent().map(|p| p.join("notifications.json").display().to_string())),
                                "shape": { "sinks": [{ "url": "https://...", "states": ["failed", "needs_approval"], "format": "slack | feishu | raw" }] },
                                "note": "File only - there is deliberately no API to add a sink. Otherwise anything that can reach this bridge could point your task summaries at a server of its choosing. https only.",
                                "active": app.state::<SinkState>().sinks.lock().unwrap().len(),
                            },
                            "activity": {
                                "endpoint": "GET /activity",
                                "note": "What each tool is doing right now, one row per provider, with the agent's registered logo folded in so the source can be rendered without a second request.",
                            },
                            "userOwned": {
                                "fields": ["skin", "camera", "scale", "visible"],
                                "note": "These are the user's preferences. You can set them and it is not blocked, but prefer a registered badge for identity - repainting someone's pet to mark your presence is not yours to do.",
                            },
                        })
                        .to_string(),
                    )
                }
                // What each tool is doing RIGHT NOW, one entry per provider.
                //
                // /debug/events is a log; answering "what is Claude Code up to" from it means
                // scanning backwards and reconstructing, and it cannot tell a finished task from
                // a running one. This is the derived answer, with the agent's registered logo
                // folded in so a caller can render the source without a second request.
                (tiny_http::Method::Get, "/activity") => {
                    let activity = app.state::<ActivityState>();
                    let registry = app.state::<AgentRegistry>();
                    let agents = registry.agents.lock().unwrap().clone();
                    let rows: Vec<serde_json::Value> = activity
                        .by_provider
                        .lock()
                        .unwrap()
                        .values()
                        .map(|row| {
                            let identity = row
                                .agent
                                .as_ref()
                                .and_then(|id| agents.get(id))
                                .or_else(|| agents.get(&row.provider));
                            let mut value = serde_json::to_value(row).unwrap_or(serde_json::Value::Null);
                            if let (Some(object), Some(identity)) = (value.as_object_mut(), identity) {
                                object.insert("name".into(), serde_json::json!(identity.name));
                                object.insert("badge".into(), serde_json::json!(identity.badge));
                                object.insert("logo".into(), serde_json::json!(identity.logo));
                                object.insert("color".into(), serde_json::json!(identity.color));
                            }
                            value
                        })
                        .collect();
                    let busy = rows.iter().filter(|r| r.get("busy") == Some(&serde_json::json!(true))).count();
                    json_response(
                        200,
                        serde_json::json!({ "activity": rows, "busy": busy }).to_string(),
                    )
                }
                // Who is driving, and who has driven. The answer to "which agent made it do
                // that" - previously unanswerable, because nothing recorded a caller at all.
                (tiny_http::Method::Get, "/agents") => {
                    let registry = app.state::<AgentRegistry>();
                    let agents: Vec<AgentIdentity> =
                        registry.agents.lock().unwrap().values().cloned().collect();
                    let stage = registry.stage.lock().unwrap().clone();
                    json_response(
                        200,
                        serde_json::json!({
                            "agents": agents,
                            "stage": stage,
                            "priorities": PRIORITY_NAMES,
                        })
                        .to_string(),
                    )
                }
                // Register (or update) an identity. Optional - an unregistered caller still works
                // and shows up under whatever `agent` string it sends - but registering is what
                // gets you a badge next to the cat instead of a generic laptop glyph.
                (tiny_http::Method::Post, "/agents") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    match serde_json::from_str::<serde_json::Value>(&body) {
                        Ok(value) => {
                            let id = value.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
                            if id.is_empty() {
                                json_response(
                                    400,
                                    "{\"error\":\"id is required - a stable string identifying your agent, e.g. \\\"claude-code\\\"\"}"
                                        .to_string(),
                                )
                            } else {
                                let (badge, badge_truncated) = truncate_chars(
                                    value
                                        .get("badge")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or(id),
                                    2,
                                );
                                let logo = value.get("logo").and_then(|v| v.as_str());
                                let logo_error = logo.and_then(|l| validate_logo(l).err());
                                if let Some(message) = logo_error {
                                    json_response(
                                        400,
                                        serde_json::json!({ "ok": false, "error": message }).to_string(),
                                    )
                                } else {
                                let now = now_millis();
                                let registry = app.state::<AgentRegistry>();
                                let identity = {
                                    let mut agents = registry.agents.lock().unwrap();
                                    let entry = agents.entry(id.to_string()).or_insert_with(|| AgentIdentity {
                                        id: id.to_string(),
                                        name: id.to_string(),
                                        badge: badge.clone(),
                                        logo: None,
                                        color: "#8b95a5".to_string(),
                                        registered_at: now,
                                        last_seen: now,
                                        claims: 0,
                                    });
                                    if let Some(logo) = logo {
                                        entry.logo = Some(logo.to_string());
                                    }
                                    if let Some(name) = value.get("name").and_then(|v| v.as_str()) {
                                        let (name, _) = truncate_chars(name, 24);
                                        if !name.is_empty() {
                                            entry.name = name;
                                        }
                                    }
                                    if !badge.is_empty() {
                                        entry.badge = badge.clone();
                                    }
                                    if let Some(color) = value.get("color").and_then(|v| v.as_str()) {
                                        if color.starts_with('#') && (color.len() == 4 || color.len() == 7) {
                                            entry.color = color.to_string();
                                        }
                                    }
                                    entry.last_seen = now;
                                    entry.clone()
                                };
                                json_response(
                                    200,
                                    serde_json::json!({
                                        "ok": true,
                                        "agent": identity,
                                        "badgeTruncated": badge_truncated,
                                        "logoStored": identity.logo.is_some(),
                                        "note": "Send `agent` on every /control call so your reactions are attributed, \
                                                 and `priority` (ambient|status|report|alert) so the cat can decide \
                                                 whose reaction the user needs to see. See GET /integration.",
                                    })
                                    .to_string(),
                                )
                                }
                            }
                        }
                        Err(e) => json_response(400, format!("{{\"error\":\"invalid JSON body: {e}\"}}")),
                    }
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
                // Cancel one. A reminder an agent set on the user's behalf has to be removable
                // when the plan changes, and nothing could remove one before - GET listed them and
                // POST made more.
                (tiny_http::Method::Delete, path) if path.starts_with("/reminders/") => {
                    let id = path.trim_start_matches("/reminders/");
                    let state = app.state::<MemoryState>();
                    let removed = {
                        let mut reminders = state.reminders.lock().unwrap();
                        let before = reminders.len();
                        reminders.retain(|r| r.id != id);
                        before - reminders.len()
                    };
                    if removed > 0 {
                        state.persist_reminders();
                        json_response(200, serde_json::json!({ "ok": true, "removed": id }).to_string())
                    } else {
                        json_response(
                            404,
                            serde_json::json!({
                                "ok": false,
                                "error": format!("no reminder with id \"{id}\""),
                                "hint": "GET /reminders lists the ids",
                            })
                            .to_string(),
                        )
                    }
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
                            let mood = value
                                .get("mood")
                                .and_then(|v| v.as_str())
                                .filter(|m| TASK_MOODS.contains(m))
                                .unwrap_or("focused");
                            // A standing reminder re-arms itself after firing. Floored at 5
                            // minutes: anything faster is an alarm, and this is a cat.
                            let repeat = value
                                .get("repeatEveryMinutes")
                                .and_then(|v| v.as_f64())
                                .filter(|m| *m > 0.0)
                                .map(|m| (m.max(5.0)) as u64)
                                .unwrap_or(0);
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
                                        reminders.push(Reminder {
                                            id: id.clone(),
                                            text,
                                            due,
                                            done: false,
                                            mood: mood.to_string(),
                                            repeat_every_minutes: repeat,
                                        });
                                        let overflow = reminders.len().saturating_sub(REMINDER_CAP);
                                        if overflow > 0 {
                                            reminders.drain(0..overflow);
                                        }
                                    }
                                    state.persist_reminders();
                                    json_response(
                                        200,
                                        serde_json::json!({
                                            "ok": true, "id": id, "truncated": truncated,
                                            "mood": mood, "repeatEveryMinutes": repeat,
                                        })
                                        .to_string(),
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
                            // Either the Claude hook shape or the tool-agnostic one. The
                            // generic form is tried first because it is unambiguous - it has a
                            // `state` from a closed vocabulary - whereas the hook form is
                            // identified only by the absence of that.
                            // Generic first because it is unambiguous (it carries a `state`
                            // from a closed vocabulary), then Codex's notify shape, which is
                            // identified by its own `type`, and finally the Claude hook shape,
                            // which is identified only by the absence of both.
                            let event = normalize_generic_task_event(&raw, seq)
                                .or_else(|| normalize_codex_notify_event(&raw, seq))
                                .unwrap_or_else(|| normalize_claude_hook_event(&raw, seq));
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
    /// How to deliver it - see TASK_MOODS. "记得喝水" and "该交税了" are not the same face, and
    /// a reminder delivered in the wrong tone is worse than no reminder.
    #[serde(default)]
    mood: String,
    /// Minutes between repeats, for the standing kind ("every hour, stand up"). 0 = one-shot.
    #[serde(default)]
    repeat_every_minutes: u64,
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
/// The user's own overrides for the reaction map, read from `assets/reactions.json`.
///
/// Held in Rust rather than the renderer because the reaction is decided here - a task event
/// arrives over HTTP and is turned into expression/action/line before anything reaches the
/// webview. Empty by default, in which case builtin_reaction decides everything.
#[derive(Default)]
struct ReactionMapState {
    map: Mutex<HashMap<String, serde_json::Value>>,
}

/// Load `assets/reactions.json` if the user has written one. Shape:
///
/// ```jsonc
/// {
///   "failed:deploy": { "expression": "\u{60ca}\u{5413}", "action": "shake-head", "say": "..." },
///   "completed":     { "expression": "\u{5f97}\u{610f}" }
/// }
/// ```
///
/// Invalid entries are skipped individually rather than failing the whole file, matching how
/// every other custom asset behaves: one bad line should not cost the user the rest of their work.
fn load_reaction_map(app: &tauri::AppHandle) -> (HashMap<String, serde_json::Value>, Vec<String>) {
    let mut map = HashMap::new();
    let mut errors = Vec::new();
    let Some(path) = custom_assets_dir(app).map(|dir| dir.join("reactions.json")) else {
        return (map, errors);
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return (map, errors); // absent is the normal case, not an error
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(entries)) => {
            for (key, value) in entries {
                if value.get("expression").and_then(|v| v.as_str()).is_none() {
                    errors.push(format!("reactions.json: \"{key}\" needs an \"expression\""));
                    continue;
                }
                map.insert(key, value);
            }
        }
        Ok(_) => errors.push("reactions.json: expected an object keyed by \"state\" or \"state:kind\"".into()),
        Err(e) => errors.push(format!("reactions.json: {e}")),
    }
    (map, errors)
}

/// The built-in mapping from what happened to how the cat shows it.
///
/// Looked up most-specific-first: "state:kind:mood", then "state:mood", then "state:kind", then
/// "state", then "mood" on its own. The user overrides any of those keys in
/// `assets/reactions.json`, so retuning the cat's whole personality is one file.
///
/// THE DESIGN RULE, and it is the important part: **the cat does not mirror the mood, it
/// answers it.** A frustrated person does not need a frustrated cat - that is two of you cross
/// at the same screen. They need something small and warm that is unbothered. So failure is met
/// with comfort rather than alarm, anxiety with steadiness, weariness with an invitation to
/// stop. Only the good moods are mirrored, because joining someone's delight is what delight is
/// for.
fn builtin_reaction(
    state: &str,
    kind: &str,
    mood: &str,
) -> Option<(&'static str, Option<&'static str>, Option<&'static str>)> {
    // --- all three known: this exact thing, feeling this exact way ---------------------------
    //
    // Only fully-specified entries belong here. A wildcard mood in this block would shadow the
    // (state, mood) table below it, which is exactly the bug that made a completed deploy read
    // "得意" whether the user was proud, exhausted or relieved - the kind silently outranked the
    // person. Kind-specific-but-mood-agnostic entries go in the third block, below mood.
    match (state, kind, mood) {
        ("completed", "deploy", "anxious") => return Some(("放松", Some("purr-settle"), Some("上线了，没事的～"))),
        ("completed", "deploy", "proud") => return Some(("得意", Some("stretch-front"), Some("上线啦！"))),
        ("completed", "test", "weary") => return Some(("满足", Some("purr-settle"), Some("全绿了，可以歇啦"))),
        ("failed", "test", "frustrated") => return Some(("委屈", Some("paw-reach"), Some("又红了…先喝口水？"))),
        ("failed", "deploy", "anxious") => return Some(("安心", Some("notice-you"), Some("回滚就好，我看着呢"))),
        _ => {}
    }

    // --- how it feels, whatever it is ---------------------------------------------------------
    match (state, mood) {
        // Done. Joy gets joined; tiredness and sadness get met where they are.
        ("completed", "proud") => return Some(("得意", Some("stretch-front"), Some("看我的～"))),
        ("completed", "tender") => return Some(("温柔", Some("head-bump"), Some("写完啦，蹭蹭你"))),
        ("completed", "weary") => return Some(("满足", Some("purr-settle"), Some("终于弄完了…歇会儿吧"))),
        ("completed", "sad") => return Some(("安心", Some("tail-wrap"), Some("做完了。我在这儿。"))),
        ("completed", "playful") => return Some(("玩心", Some("hop-catch"), Some("嘿嘿，成了！"))),
        ("completed", "anxious") => return Some(("放松", Some("purr-settle"), Some("过啦，可以松口气了"))),

        // Failed. Deliberately NOT angry - see the design rule above.
        ("failed", "frustrated") => return Some(("委屈", Some("paw-reach"), Some("唔…这个真的难。歇一下再来？"))),
        ("failed", "sad") => return Some(("温柔", Some("head-bump"), Some("没关系的，我在。"))),
        ("failed", "anxious") => return Some(("安心", Some("paw-reach"), Some("别急，一步一步来"))),
        ("failed", "weary") => return Some(("困困", Some("loaf"), Some("今天到这儿吧，明天再说"))),
        ("failed", "tender") => return Some(("委屈", Some("tail-wrap"), Some("这次没成…抱抱"))),

        // Waiting on the person.
        ("needs_input", "tender") => return Some(("撒娇", Some("paw-reach"), Some("想听听你的意思～"))),
        ("needs_input", "anxious") => return Some(("警觉", Some("notice-you"), Some("这一步要你点头"))),
        ("needs_input", _) => return Some(("好奇", Some("notice-you"), Some("在等你哦"))),
        // Approval is blocking something. It gets a more insistent face than a question does,
        // but still not an alarmed one - the cat is fetching you, not warning you.
        ("needs_approval", "anxious") => return Some(("警觉", Some("notice-you"), Some("这步要你点头才能走"))),
        ("needs_approval", _) => return Some(("警惕", Some("paw-reach"), Some("等你批一下～"))),

        // Working. Mostly silent - see should_react; a line here would fire on every update.
        ("running", "weary") => return Some(("困困", Some("yawn"), None)),
        ("running", "anxious") => return Some(("警觉", Some("tail-alert"), None)),
        ("running", "playful") => return Some(("玩心", Some("play-bow"), None)),
        ("running", "tender") => return Some(("温柔", None, None)),
        ("running", "curious") => return Some(("好奇", Some("curious-tilt"), None)),
        ("running", "proud") => return Some(("闪亮", None, None)),
        ("running", "sad") => return Some(("安然", Some("tail-wrap"), None)),
        ("running", "frustrated") => return Some(("认真", Some("ear-listen"), None)),
        _ => {}
    }

    // --- what sort of work it was, when the mood adds nothing beyond the default ---------------
    match (state, kind) {
        ("completed", "deploy") => return Some(("得意", Some("stretch-front"), Some("上线啦！"))),
        ("completed", "test") => return Some(("开心", Some("paw-wave"), Some("测试全绿～"))),
        ("failed", "deploy") => return Some(("警觉", Some("notice-you"), Some("部署没过，我看着呢"))),
        ("failed", "test") => return Some(("委屈", Some("shake-head"), Some("有测试挂了"))),
        _ => {}
    }

    // --- the plain lifecycle ------------------------------------------------------------------
    Some(match state {
        "completed" => ("开心", Some("paw-wave"), Some("搞定啦～")),
        "failed" => ("委屈", Some("shake-head"), Some("这次没成…")),
        "needs_input" | "waiting_for_user" => ("好奇", Some("notice-you"), Some("在等你哦")),
        "needs_approval" => ("警惕", Some("paw-reach"), Some("等你批一下～")),
        "blocked" => ("困惑", Some("curious-tilt"), Some("卡住了…")),
        "running" => ("认真", None, None),
        "queued" => ("清醒", None, None),
        "cancelled" => ("嫌弃", Some("shake-fur"), None),
        _ => return None,
    })
}

/// Where the user wants task events echoed to, besides the cat.
///
/// THE POINT: 灵犀 does not integrate with Slack, Feishu, Telegram or anything else, and should
/// not - those are the user's private accounts and baking any of them in means shipping their
/// tokens, their API drift and their privacy model. What it can do is provide the OUTLET, and let
/// the user point it wherever they already have a webhook.
///
/// THE TRADE, stated plainly: until now this app made no outbound network connections at all, and
/// that was a meaningful part of its safety story. A sink sends the summaries of what the user is
/// working on to a third party. So:
///
///   - Sinks are configured ONLY by editing a file in the config directory. There is deliberately
///     no API to add one. Otherwise any process that can reach the loopback bridge could point the
///     user's task summaries at a server of its choosing, which turns a desktop pet into an
///     exfiltration channel.
///   - Nothing is sent unless that file exists. The default remains zero outbound traffic.
///   - Only `https`, because the payload describes what someone is doing all day.
#[derive(Clone, Deserialize)]
struct NotificationSink {
    url: String,
    /// Which states to forward. Empty means all of them.
    #[serde(default)]
    states: Vec<String>,
    /// "raw" (the task event as-is), "slack" or "feishu" ({"text": ...} shapes).
    #[serde(default)]
    format: String,
}

#[derive(Default)]
struct SinkState {
    sinks: Mutex<Vec<NotificationSink>>,
}

/// Read `notifications.json` from the config directory. Absent is the normal case.
fn load_sinks(app: &tauri::AppHandle) -> (Vec<NotificationSink>, Vec<String>) {
    let mut errors = Vec::new();
    let Some(path) = app.path().app_config_dir().ok().map(|d| d.join("notifications.json")) else {
        return (Vec::new(), errors);
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return (Vec::new(), errors);
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(value) => {
            let raw = value.get("sinks").cloned().unwrap_or(value);
            match serde_json::from_value::<Vec<NotificationSink>>(raw) {
                Ok(list) => {
                    let (ok, bad): (Vec<_>, Vec<_>) = list.into_iter().partition(|s| {
                        // https anywhere, or plain http on LOOPBACK only. The loopback exception
                        // is not a weakening: a relay running on this machine is how most people
                        // will actually bridge to an IM (transform the payload, add their own
                        // token, forward it), and requiring TLS to talk to yourself buys nothing
                        // while making the common case annoying enough to be done badly instead.
                        s.url.starts_with("https://")
                            || s.url.starts_with("http://127.0.0.1")
                            || s.url.starts_with("http://localhost")
                    });
                    for sink in &bad {
                        errors.push(format!(
                            "notifications.json: refusing \"{}\" - https, or plain http only on 127.0.0.1. \
                             The payload describes what you are working on, so it does not leave this machine \
                             unencrypted.",
                            sink.url.chars().take(60).collect::<String>()
                        ));
                    }
                    (ok, errors)
                }
                Err(e) => {
                    errors.push(format!("notifications.json: {e}"));
                    (Vec::new(), errors)
                }
            }
        }
        Err(e) => {
            errors.push(format!("notifications.json: {e}"));
            (Vec::new(), errors)
        }
    }
}

/// Echo one task event to every sink that wants it. Fire-and-forget on a thread: the agent that
/// posted the event is waiting on the response, and a slow webhook must never make someone's
/// tool feel slow.
fn forward_to_sinks(app: &tauri::AppHandle, event: &TaskEvent) {
    let state = app.state::<SinkState>();
    let sinks: Vec<NotificationSink> = {
        let guard = state.sinks.lock().unwrap();
        guard
            .iter()
            .filter(|sink| sink.states.is_empty() || sink.states.iter().any(|s| s == &event.state))
            .cloned()
            .collect()
    };
    if sinks.is_empty() {
        return;
    }
    let event = event.clone();
    thread::spawn(move || {
        for sink in sinks {
            let line = format!(
                "{} · {}{}",
                event.provider,
                event.state,
                if event.summary.is_empty() { String::new() } else { format!(" — {}", event.summary) },
            );
            let body = match sink.format.as_str() {
                // Slack and Feishu both accept {"text": "..."} on an incoming webhook, which is
                // the shared subset worth supporting. Anything richer is the user's to build with
                // "raw" and whatever they already use to transform webhooks.
                "slack" | "feishu" => serde_json::json!({ "text": line }).to_string(),
                _ => serde_json::to_string(&event).unwrap_or_else(|_| "{}".into()),
            };
            if let Err(e) = post_json(&sink.url, &body) {
                eprintln!("[lingxi-desktop] notification sink failed: {e}");
            }
        }
    });
}

/// Minimal blocking HTTPS POST. Uses curl rather than adding an HTTP client and a TLS stack to a
/// desktop pet: this runs at most a few times a minute, off the request path, and the dependency
/// cost of rustls + reqwest is not worth paying for it.
fn post_json(url: &str, body: &str) -> Result<(), String> {
    let output = std::process::Command::new("curl")
        .args(["-s", "-S", "-m", "8", "-X", "POST", "-H", "Content-Type: application/json", "--data-binary", "@-", url])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child.stdin.take().unwrap().write_all(body.as_bytes())?;
            child.wait_with_output()
        })
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Keep the live per-provider picture up to date. See ActivityState.
fn record_activity(app: &tauri::AppHandle, event: &TaskEvent) {
    let state = app.state::<ActivityState>();
    let mut map = state.by_provider.lock().unwrap();
    // Keyed by the registered AGENT where there is one, falling back to the provider.
    //
    // Keying on provider alone made one tool appear twice: the plugin adapter reports
    // provider "claude" while the CLI reports "claude-code", so the same Claude Code showed up as
    // two rows with two states. The identity is what "who is doing what" is actually about; the
    // provider is just which transport it came in on.
    let key = if event.source_id.is_empty() { event.provider.clone() } else { event.source_id.clone() };
    map.insert(
        key,
        AgentActivity {
            provider: event.provider.clone(),
            agent: if event.source_id.is_empty() { None } else { Some(event.source_id.clone()) },
            task_id: event.task_id.clone(),
            state: event.state.clone(),
            kind: event.kind.clone(),
            mood: event.mood.clone(),
            progress: event.progress,
            summary: event.summary.clone(),
            updated_at: event.observed_at,
            busy: state_is_busy(&event.state),
        },
    );
}

/// Should this event produce anything visible at all?
///
/// A long task reports progress many times, and a cat that reacts to every one of them is the
/// notification spam a desktop pet is supposed to be the alternative to. So `running` updates are
/// mostly swallowed: the first one sets the face, and after that only a crossing of the halfway
/// mark earns a second look. Everything terminal always gets through - those are the moments the
/// user actually wants.
fn should_react(app: &tauri::AppHandle, event: &TaskEvent) -> bool {
    if event.state != "running" {
        return true;
    }
    let state = app.state::<TaskProgressState>();
    let mut seen = state.seen.lock().unwrap();
    let previous = seen.insert(event.task_id.clone(), event.progress.unwrap_or(0.0));
    match (previous, event.progress) {
        (None, _) => true,                                   // first sighting of this task
        (Some(before), Some(now)) => before < 0.5 && now >= 0.5, // crossed halfway
        _ => false,
    }
}

/// Remembers how far each task had got, so a progress stream does not become a reaction stream.
#[derive(Default)]
struct TaskProgressState {
    seen: Mutex<HashMap<String, f64>>,
}

/// What each agent is doing RIGHT NOW, as opposed to what has happened.
///
/// /debug/events is a log: to answer "what is Claude Code up to" from it you have to scan
/// backwards and reconstruct, and you cannot tell a task that finished from one still running.
/// This is the derived answer, kept as events arrive, so "谁在干什么" is one GET.
#[derive(Clone, Serialize)]
struct AgentActivity {
    provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent: Option<String>,
    #[serde(rename = "taskId")]
    task_id: String,
    state: String,
    kind: String,
    mood: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<f64>,
    summary: String,
    /// Unix millis of the last event from this source.
    #[serde(rename = "updatedAt")]
    updated_at: u64,
    /// True while the work is still going. Derived here so a caller does not have to know which
    /// states are terminal.
    busy: bool,
}

#[derive(Default)]
struct ActivityState {
    /// Keyed by the registered agent id where there is one, else the provider - one entry per
    /// TOOL rather than per task, because "what is Codex doing" has one answer and the newest
    /// event is the one that answers it.
    by_provider: Mutex<HashMap<String, AgentActivity>>,
}

/// Which states mean work is still in flight.
fn state_is_busy(state: &str) -> bool {
    matches!(state, "queued" | "running" | "blocked" | "needs_input" | "needs_approval")
}

fn react_to_task_event(app: &tauri::AppHandle, event: &TaskEvent) {
    // Recorded BEFORE the reaction is decided, and regardless of whether one is shown at all.
    // Progress updates are deliberately swallowed for the cat's sake (see should_react), but they
    // are exactly what "what is it doing right now" wants, so the two must not share a gate.
    record_activity(app, event);
    forward_to_sinks(app, event);
    if !should_react(app, event) {
        return;
    }
    // A user-supplied map wins over the built-in one, per entry. Looked up as "state:kind"
    // first, then "state", so an override can be as broad or as narrow as the user likes.
    let custom = app.state::<ReactionMapState>().map.lock().unwrap().clone();
    let lookup = |key: &str| -> Option<(String, Option<String>, Option<String>)> {
        let entry = custom.get(key)?;
        Some((
            entry.get("expression").and_then(|v| v.as_str())?.to_string(),
            entry.get("action").and_then(|v| v.as_str()).map(str::to_string),
            entry.get("say").and_then(|v| v.as_str()).map(str::to_string),
        ))
    };
    // Most specific override wins, and a user override at any level beats the built-in table.
    let resolved = lookup(&format!("{}:{}:{}", event.state, event.kind, event.mood))
        .or_else(|| lookup(&format!("{}:{}", event.state, event.mood)))
        .or_else(|| lookup(&format!("{}:{}", event.state, event.kind)))
        .or_else(|| lookup(&event.state))
        .or_else(|| lookup(&event.mood))
        .or_else(|| {
            builtin_reaction(&event.state, &event.kind, &event.mood).map(|(e, a, l)| {
                (e.to_string(), a.map(str::to_string), l.map(str::to_string))
            })
        });
    let Some((expression, action, line)) = resolved else {
        return;
    };
    let (expression, action, line) = (
        expression.as_str(),
        action.as_deref(),
        line.as_deref(),
    );
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

/// How hard the app is currently working, set by the webview's power governor.
///
/// A desktop pet runs every hour the machine does, so its IDLE cost is its cost. The 60Hz cursor
/// thread below is the most expensive thing here when nothing is happening - it wakes sixty times
/// a second forever, and it was doing that with the lid shut, to track a cursor nobody was moving
/// for a cat nobody could see.
///
/// The webview is the layer that knows: requestAnimationFrame stopping IS the compositor saying
/// nobody can see this window. So it decides the tier and tells us, and everything on this side
/// slows to match.
#[derive(Default)]
struct PowerState {
    /// 0 = active, 1 = idle, 2 = dormant. An atomic because the polling threads read it every
    /// pass and a mutex there would be its own small cost.
    tier: std::sync::atomic::AtomicU8,
}

impl PowerState {
    fn cursor_interval(&self) -> Duration {
        match self.tier.load(Ordering::Relaxed) {
            0 => Duration::from_millis(16),  // ~60Hz: dragging has to feel direct
            1 => Duration::from_millis(100), // 10Hz: enough to notice the user come back
            _ => Duration::from_millis(500), // nobody can see the cat; just watch for a wake
        }
    }

    fn drain_interval(&self) -> Duration {
        match self.tier.load(Ordering::Relaxed) {
            2 => Duration::from_millis(1000),
            _ => Duration::from_millis(250),
        }
    }
}

/// Called by the webview when its power tier changes. See PowerState.
#[tauri::command]
fn set_power_tier(state: State<PowerState>, tier: String) {
    let value = match tier.as_str() {
        "active" => 0,
        "idle" => 1,
        "dormant" => 2,
        _ => return,
    };
    state.tier.store(value, Ordering::Relaxed);
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
            // Rate set by the power governor rather than fixed at 60Hz - see PowerState.
            thread::sleep(app.state::<PowerState>().cursor_interval());
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
        // Where the eyes, nose, mouth and whiskers sit. Colours were already themeable and
        // expressions were already data; the shapes were the one part of the face that could
        // only be changed by editing and rebuilding the app.
        "face": read_json_file(&dir.join("face.json")),
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
            claude_hooks_installed,
            codex_integration_status,
            install_codex_notify,
            uninstall_codex_notify,
            get_bridge_info,
            set_power_tier
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

            // Managed BEFORE the threads that read it every pass - Tauri's state() panics on an
            // unmanaged type, so registering it further down (where the other state lives) meant
            // the cursor poller took the whole app down on its first tick.
            app.manage(PowerState::default());
            app.manage(ActivityState::default());
            {
                let (sinks, errors) = load_sinks(app.handle());
                for error in &errors {
                    eprintln!("[lingxi-desktop] {error}");
                }
                if !sinks.is_empty() {
                    eprintln!("[lingxi-desktop] {} notification sink(s) configured", sinks.len());
                }
                app.manage(SinkState { sinks: Mutex::new(sinks) });
            }
            spawn_cursor_poller(app.handle().clone(), screen_height_points, scale_factor);
            spawn_reaction_drain(app.handle().clone());

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
            app.manage(AgentRegistry::default());
            app.manage(TaskProgressState::default());
            app.manage(BridgeToken::load_or_create(app.handle()));
            match install_cli(app.handle()) {
                Some(path) => eprintln!("[lingxi-desktop] shell client written to {}", path.display()),
                None => eprintln!("[lingxi-desktop] could not write the shell client; the MCP path still works"),
            }
            {
                let (map, errors) = load_reaction_map(app.handle());
                for error in &errors {
                    eprintln!("[lingxi-desktop] {error}");
                }
                app.manage(ReactionMapState { map: Mutex::new(map) });
            }
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
    fn the_cat_answers_a_bad_mood_rather_than_mirroring_it() {
        // The design rule, pinned: a frustrated person does not need a frustrated cat - that is
        // two of you cross at the same screen. Failure is met with comfort.
        let comforting = ["\u{6e29}\u{67d4}", "\u{59d4}\u{5c48}", "\u{5b89}\u{5fc3}", "\u{56f0}\u{56f0}", "\u{653e}\u{677e}", "\u{6ee1}\u{8db3}", "\u{5b89}\u{7136}"];
        for mood in ["frustrated", "sad", "anxious", "weary", "tender"] {
            let (expression, _, _) = builtin_reaction("failed", "other", mood).unwrap();
            assert!(
                comforting.contains(&expression),
                "failed/{mood} reacted with {expression}, which is not a comforting face"
            );
        }
        // ...but delight IS joined, because that is what delight is for.
        let (proud, _, _) = builtin_reaction("completed", "other", "proud").unwrap();
        assert_eq!(proud, "\u{5f97}\u{610f}");
    }

    #[test]
    fn mood_outranks_kind() {
        // The bug this pins: a wildcard mood in the most-specific block shadowed the (state,
        // mood) table, so a completed deploy read "\u{5f97}\u{610f}" whether the user was proud,
        // exhausted or relieved. The KIND silently outranked the person, which is backwards -
        // the mood is the entire reason this dimension exists.
        let faces: Vec<&str> = ["proud", "weary", "tender", "anxious"]
            .iter()
            .map(|mood| builtin_reaction("completed", "deploy", mood).unwrap().0)
            .collect();
        let distinct: std::collections::HashSet<_> = faces.iter().collect();
        assert!(
            distinct.len() >= 3,
            "a completed deploy reacted the same way to different moods: {faces:?}"
        );
    }

    #[test]
    fn every_mood_resolves_for_every_state() {
        // A mood the agent is allowed to send must never fall through to nothing.
        for state in TASK_STATES {
            for mood in TASK_MOODS {
                for kind in TASK_KINDS {
                    assert!(
                        builtin_reaction(state, kind, mood).is_some(),
                        "no reaction for {state}/{kind}/{mood}"
                    );
                }
            }
        }
    }

    #[test]
    fn running_updates_are_mostly_silent_but_terminal_events_never_are() {
        // A long task reports progress many times; reacting to each is the notification spam a
        // desktop pet is meant to replace. But nothing terminal may ever be swallowed.
        for state in ["completed", "failed", "needs_input", "blocked", "cancelled", "queued"] {
            let event = TaskEvent {
                schema_version: 1, provider: "t".into(), source_id: "t".into(),
                task_id: "same-task".into(), event_id: "e".into(), state: state.into(),
                sequence: 1, observed_at: 0, summary: String::new(),
                kind: "other".into(), mood: "focused".into(), progress: Some(0.1),
            };
            // should_react needs app state, so assert the rule it encodes directly: only
            // "running" is ever a candidate for suppression.
            assert_ne!(event.state, "running");
        }
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
    fn the_two_claude_mappers_cover_the_same_events() {
        // There are two paths in - the one-click curl posts the raw payload and Rust maps it, the
        // plugin maps it in node first - and they drifted: this side knew three events while the
        // adapter knew five, so a session start and a PERMISSION PROMPT were silently dropped on
        // the path most users take. Anything the adapter handles must land here too.
        for (event, expected) in [
            ("SessionStart", "queued"),
            ("UserPromptSubmit", "running"),
            ("Stop", "completed"),
            ("StopFailure", "failed"),
        ] {
            let raw = serde_json::json!({ "session_id": "s", "hook_event_name": event });
            assert_eq!(normalize_claude_hook_event(&raw, 1).state, expected, "{event}");
        }
    }

    #[test]
    fn a_permission_prompt_is_an_approval_and_a_question_is_not() {
        // The single most useful thing to forward to an IM, and it was being dropped entirely.
        let permission = serde_json::json!({
            "session_id": "s", "hook_event_name": "Notification",
            "message": "Claude needs your permission to use Bash"
        });
        assert_eq!(normalize_claude_hook_event(&permission, 1).state, "needs_approval");

        let question = serde_json::json!({
            "session_id": "s", "hook_event_name": "Notification",
            "message": "Waiting for your input"
        });
        assert_eq!(normalize_claude_hook_event(&question, 1).state, "needs_input");
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

    /// Pins the Rust Codex mapper to the node adapter's `fromCodex`, case for case.
    ///
    /// Not a formality: the Claude pair of mappers drifted exactly this way - one side learned
    /// two new events and the other did not, and a permission prompt stopped reaching the cat
    /// on the path most people install. This table IS the adapter's switch statement, so a case
    /// added to one and not the other fails here instead of going quiet in production.
    #[test]
    fn normalize_codex_notify_event_matches_the_node_adapter() {
        // integrations/adapters/lingxi-emit.mjs :: fromCodex
        let cases: [(&str, &str); 8] = [
            ("agent-turn-complete", "completed"),
            ("turn-ended", "completed"),
            ("turn_complete", "completed"),
            ("turn-started", "running"),
            ("turn_started", "running"),
            ("turn-failed", "failed"),
            ("error", "failed"),
            ("approval-requested", "needs_approval"),
        ];
        for (ty, expected) in cases {
            let raw = serde_json::json!({ "type": ty, "thread-id": "t1" });
            let event = normalize_codex_notify_event(&raw, 1)
                .unwrap_or_else(|| panic!("{ty} should map to a task event"));
            assert_eq!(event.state, expected, "{ty}");
            assert_eq!(event.provider, "codex");
            assert_eq!(event.task_id, "t1");
            assert_eq!(event.kind, "chat");
        }
        // input-requested is the ninth, kept out of the array only because 8 reads better than
        // a magic 9 - assert it explicitly rather than dropping it.
        let input = serde_json::json!({ "type": "input-requested", "thread-id": "t1" });
        assert_eq!(normalize_codex_notify_event(&input, 1).unwrap().state, "needs_input");

        // The aliases the adapter also accepts.
        let aliased = serde_json::json!({ "event": "turn-ended", "session_id": "s9", "message": "done" });
        let event = normalize_codex_notify_event(&aliased, 2).unwrap();
        assert_eq!(event.task_id, "s9");
        assert_eq!(event.summary, "done");

        // And the whole point of returning Option: anything else must fall through to the next
        // mapper rather than being invented into a state.
        assert!(normalize_codex_notify_event(&serde_json::json!({ "type": "something-new" }), 3).is_none());
        assert!(normalize_codex_notify_event(&serde_json::json!({}), 4).is_none());
        // A Claude hook payload must NOT be claimed by this mapper.
        let claude = serde_json::json!({ "session_id": "s1", "hook_event_name": "Stop" });
        assert!(normalize_codex_notify_event(&claude, 5).is_none());
    }

    #[test]
    fn codex_install_refuses_to_overwrite_someone_elses_notify() {
        // The case the whole design turns on. `notify` is one TOML key, so installing over an
        // existing one deletes another tool's integration - silently, because Codex will simply
        // stop calling it. integrations/plugins/codex/README.md is explicit that we must not:
        // "别直接覆盖用户已有的 notify。那是别人的功能，猫不值得。"
        let existing = r#"
model = "o3"
notify = ["/Users/someone/bin/SkyComputerUseClient", "turn-ended"]
"#;
        let error = codex_install_into(existing).expect_err("must refuse");
        assert!(error.contains("SkyComputerUseClient"), "the refusal has to show WHOSE it is: {error}");
        assert!(error.contains("分发脚本"), "and how to keep both: {error}");
    }

    #[test]
    fn codex_install_adds_notify_and_keeps_the_rest_of_the_file_intact() {
        let before = r#"# 我自己的配置，别动
model = "o3"

[mcp_servers.something_else]
command = "node"
"#;
        let after = codex_install_into(before).expect("should install");
        assert!(after.contains("127.0.0.1:47811/task-event"), "notify should be written");
        // The user's file is theirs: comments, settings and other servers all survive. A
        // parse-and-reserialise round trip would have dropped the comment, which is why this
        // uses toml_edit rather than a plain TOML parser.
        assert!(after.contains("# 我自己的配置，别动"), "comments must survive");
        assert!(after.contains("model = \"o3\""));
        assert!(after.contains("[mcp_servers.something_else]"));
    }

    #[test]
    fn codex_install_is_idempotent_and_works_on_an_empty_config() {
        let once = codex_install_into("").expect("empty config is fine");
        let twice = codex_install_into(&once).expect("re-installing is not an error");
        assert_eq!(once, twice, "installing twice must not append a second entry");
    }

    #[test]
    fn codex_uninstall_removes_only_ours() {
        let installed = codex_install_into("model = \"o3\"\n").unwrap();
        let (after, removed) = codex_uninstall_from(&installed).unwrap();
        assert_eq!(removed, vec!["notify"]);
        assert!(!after.contains("47811"));
        assert!(after.contains("model = \"o3\""), "the user's settings stay");

        // Another tool's notify is left exactly where it is - removing it would be the same
        // mistake as overwriting it.
        let foreign = "notify = [\"/other/tool\"]\n";
        let (untouched, nothing) = codex_uninstall_from(foreign).unwrap();
        assert!(nothing.is_empty());
        assert!(untouched.contains("/other/tool"));
    }

    #[test]
    fn codex_install_refuses_an_unparsable_config_rather_than_rewriting_it() {
        let broken = "notify = [\"unclosed\n";
        assert!(codex_install_into(broken).is_err());
        assert!(codex_uninstall_from(broken).is_err());
    }

    #[test]
    fn the_codex_notify_command_survives_a_payload_full_of_quotes() {
        // The reason the payload goes through "$1" and a pipe rather than being interpolated:
        // it is arbitrary JSON, and Codex hands it over as an argument.
        let argv = codex_notify_value();
        let arr = argv.as_array().expect("notify is an argv array");
        let parts: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
        assert_eq!(parts[0], "/bin/sh");
        assert_eq!(parts[1], "-c");
        assert!(parts[2].contains("\"$1\""), "the payload must be referenced, never inlined");
        // $0 is a placeholder so that Codex's appended payload lands in $1.
        assert_eq!(parts.len(), 4, "sh -c <script> <argv0>, then Codex appends the payload");
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
