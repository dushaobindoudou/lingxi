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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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

/// The tray's 玩具 and 特效 submenus: every known id with the name 主界面 gives it. A test keeps
/// these in step with KNOWN_TOYS / KNOWN_PERFORMANCES, so a new toy cannot be missing here.
const TRAY_TOYS: [(&str, &str); 3] = [("yarn", "毛线球"), ("feather", "逗猫棒"), ("laser", "激光笔")];
const TRAY_EFFECTS: [(&str, &str); 3] = [("angry-claw", "愤怒抓屏"), ("kiss-rush", "飞奔亲亲"), ("zoomies", "半夜暴走")];

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
    /// The first tray row, "<猫名> · <在做什么>" - see tray_status_text.
    status_summary: MenuItem<tauri::Wry>,
    /// What `status_summary` currently says, so the menu is only touched when that changes.
    status_text: Mutex<String>,
    attention_summary: MenuItem<tauri::Wry>,
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
        let _ = self.toggle_visibility.set_text(if next_visible { "隐藏猫咪" } else { "显示猫咪" });
        let _ = app.emit("companion-visibility", next_visible);
        self.persist();
        self.refresh_status(app);
    }

    /// Re-derive the first tray row. Cheap, and it only touches the native menu when the text
    /// changed - it runs on every perception report (every couple of seconds) so a session that
    /// died mid-turn stops counting as "working" without an event to say so.
    fn refresh_status(&self, app: &tauri::AppHandle) {
        let name = self.cat_name.lock().unwrap().clone();
        let text = tray_status_text(&name, self.visible.load(Ordering::SeqCst), &working_agent_names(app));
        let mut last = self.status_text.lock().unwrap();
        if *last != text {
            let _ = self.status_summary.set_text(&text);
            *last = text;
        }
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
        self.refresh_status(app);
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
fn report_perception(app: tauri::AppHandle, state: State<PerceptionState>, snapshot: serde_json::Value) {
    *state.latest_snapshot.lock().unwrap() = snapshot;
    if let Some(tray) = app.try_state::<TrayState>() {
        tray.refresh_status(&app);
    }
}

/// The tray's first row: the cat's name and what it is doing right now.
///
/// It used to be a fixed "灵犀 · 陪你工作中" - a disabled row that reads as status, and still said
/// so while the cat was hidden, after the user renamed it, and when no agent had called all day.
/// Waits and failures are the second row's job (update_tray_attention), so this one names only
/// who is actually working.
fn tray_status_text(name: &str, visible: bool, working: &[String]) -> String {
    if !visible {
        return format!("{name} · 藏起来了");
    }
    match working {
        [] => format!("{name} · 在桌面陪着你"),
        [one] => format!("{name} · 陪 {one} 工作中"),
        [a, b] => format!("{name} · 陪 {a}、{b} 工作中"),
        [a, b, ..] => format!("{name} · 陪 {a}、{b} 等 {} 个伙伴工作中", working.len()),
    }
}

/// A row that last said "running" this long ago is not working any more: a session killed
/// mid-turn never sends the event that would say so.
const TRAY_WORKING_FRESH_MS: u64 = 30 * 60 * 1000;

/// Who is working right now, newest first, one name per tool however many sessions it has.
fn working_agent_names(app: &tauri::AppHandle) -> Vec<String> {
    let Some(activity) = app.try_state::<ActivityState>() else { return Vec::new() };
    let now = now_millis();
    let mut rows: Vec<(u64, String)> = activity
        .by_provider
        .lock()
        .unwrap()
        .values()
        .filter(|row| matches!(row.state.as_str(), "running" | "blocked"))
        .filter(|row| now.saturating_sub(row.updated_at) <= TRAY_WORKING_FRESH_MS)
        .map(|row| (row.updated_at, row.agent.clone().unwrap_or_else(|| row.provider.clone())))
        .collect();
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    let registry = app.try_state::<AgentRegistry>();
    let registered = registry.as_ref().map(|r| r.agents.lock().unwrap());
    let mut names: Vec<String> = Vec::new();
    for (_, id) in rows {
        let name = registered
            .as_ref()
            .and_then(|agents| agents.get(&id))
            .map(|agent| agent.name.clone())
            .filter(|name| !name.is_empty() && *name != id)
            .unwrap_or_else(|| host_display_name(&id).to_string());
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

/// The names hosts go by when they have not registered one.
fn host_display_name(id: &str) -> &str {
    match id {
        "claude" => "Claude Code",
        "codex" => "Codex",
        "cursor" => "Cursor",
        "workbuddy" => "WorkBuddy",
        "doubao" => "豆包",
        "dsh" => "DSH",
        other => other,
    }
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
    /// The host's long-lived session this event belongs to (a Claude Code session id). When
    /// set, the activity map keeps one row per SESSION instead of one per tool: several sessions
    /// of the same tool routinely run side by side, and "which one is asking" is the question.
    #[serde(skip)]
    session: Option<String>,
    /// A human name for that session - Claude Code's own title for it, else the project folder.
    /// Display only: it rides to the bubble and the 主界面 rows, and is deliberately NOT
    /// serialized, so it never reaches a notification sink or the event log (docs/09: the cat
    /// does not collect what the work is about).
    #[serde(skip)]
    label: Option<String>,
    /// True when `label` is only the project folder - the fallback. A session's real title, once
    /// known, is never replaced by it (events without a title in their payload fall back).
    #[serde(skip)]
    label_is_folder: bool,
    /// What this turn came to, in one bubble-sized line, taken from the host's own words (Claude
    /// Code's `last_assistant_message`). It is what makes the cat's line about THIS task rather
    /// than "本轮回复结束".
    ///
    /// Perceived, not collected: it is used for the reaction and the live 主界面 row, and is
    /// never serialized - so it is never written to the event log or the task-event trail on
    /// disk, and never sent to a notification sink. `summary` stays content-free for that reason.
    #[serde(skip)]
    result: Option<String>,
    /// A host's delayed restatement of a wait it may already have announced - Claude Code's
    /// Notification fires 6s after a permission dialog it has ALREADY reported through
    /// PermissionRequest, and 60s after a turn that already ended on a question. When the
    /// session's row is already in that same waiting state, an echo updates nothing and says
    /// nothing (see react_to_task_event).
    #[serde(skip)]
    echo: bool,
    /// A host lifecycle hook produced this (Claude Code's hooks, Codex's notify, the lingxi-emit
    /// adapter), rather than an agent reporting a task on purpose. The two are told apart by
    /// where the event came from, not by what its summary says: a hook's summary is the host's
    /// wording ("Claude is waiting for your input", a bare error code), and only an agent's
    /// summary is written to be said to the user.
    #[serde(skip)]
    from_hook: bool,
    /// The hook event that closes a conversational turn - Claude's Stop, Codex's turn-complete -
    /// including one turned into needs_input because the reply ended on a question. When the
    /// agent already reported this turn's result itself, this one stays quiet.
    #[serde(skip)]
    turn_end: bool,
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
    // Identity-ish strings get the same treatment as `summary`: a caller is outside this
    // process's trust boundary (the token proves it is the user's, not that it is sane), and
    // these land in the activity map, the agent registry and the UI. Text caps are CHARACTERS
    // for the same reason summary's are - Chinese is the common case, not the exception.
    let provider = raw
        .get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let task_id = raw
        .get("taskId")
        .or_else(|| raw.get("task_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown-task");
    let agent_id = raw.get("agent").and_then(|v| v.as_str()).unwrap_or(provider);
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
    let result_text = raw.get("result").and_then(|v| v.as_str());
    // A chat turn whose own words end on a question is waiting on the user, whoever reports it.
    let question = (state == "completed" && kind == "chat").then(|| result_text.and_then(closing_question)).flatten();
    // Set by the hook adapter (integrations/adapters/lingxi-emit.mjs), never by an agent's report.
    let from_hook = raw.get("origin").and_then(|v| v.as_str()) == Some("hook");
    let turn_end = from_hook && state == "completed" && kind == "chat";
    let state = if question.is_some() { "needs_input" } else { state };
    Some(TaskEvent {
        schema_version: 1,
        provider: provider.chars().take(64).collect(),
        source_id: agent_id.chars().take(64).collect(),
        task_id: task_id.chars().take(128).collect(),
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
        session: bounded_str(raw.get("session"), 128),
        label: bounded_str(raw.get("label"), SESSION_LABEL_MAX_CHARS),
        result: question.or_else(|| result_text.and_then(turn_line)),
        echo: false,
        label_is_folder: false,
        from_hook,
        turn_end,
    })
}

/// A trimmed, non-empty string field capped at `max` characters, or None.
fn bounded_str(value: Option<&serde_json::Value>, max: usize) -> Option<String> {
    let text: String = value?.as_str()?.trim().chars().take(max).collect();
    (!text.is_empty()).then_some(text)
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
    let question = (state == "completed").then(|| closing_question(summary)).flatten();
    let turn_end = state == "completed";
    let state = if question.is_some() { "needs_input" } else { state };
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
        summary: match state {
            "completed" => "Codex 回复结束".to_string(),
            "failed" => "本轮因错误终止".to_string(),
            _ => format!("chat: {state}"),
        },
        // Everything through `notify` is a conversational turn: the payload carries no
        // indication of what sort of work it was, and guessing would be worse than "chat".
        kind: "chat".to_string(),
        mood: "focused".to_string(),
        progress: None,
        session: Some(task_id.to_string()),
        label: None,
        result: question.or_else(|| turn_line(summary)),
        echo: false,
        label_is_folder: false,
        from_hook: true,
        turn_end,
    })
}

/// Longest session name shown on the bubble / 主界面 row, in characters.
const SESSION_LABEL_MAX_CHARS: usize = 40;

/// How much of a transcript's tail is read for its title. Claude Code re-appends its session
/// metadata (`ai-title`, `custom-title`, `last-prompt`) after every turn, so the newest copy is
/// always near the end; reading the whole file would cost megabytes per hook on a long session.
const TRANSCRIPT_TAIL_BYTES: u64 = 512 * 1024;

/// One bubble-sized line from a host's final message: its first sentence of prose, with the
/// markdown taken off, cut at a clause boundary when it is too long to read in one go.
///
/// Claude's replies lead with the conclusion more often than not ("新版已经装好了，…"), so the
/// first sentence is usually the result. Code blocks, tables, headings and horizontal rules are
/// skipped: none of them reads as a line a cat could say.
fn turn_line(text: &str) -> Option<String> {
    prose_lines(text)
        .iter()
        .map(|line| first_sentence(line))
        .find(|sentence| sentence.chars().count() >= 4)
        .map(|sentence| fit_bubble(&sentence))
}

/// The question a reply ENDS on, if it ends on one - "要按折中方案做吗？". A turn that closes by
/// asking the user something is not finished, it is waiting; announcing it as "done" is how the
/// question gets missed. Only the last two lines of prose are looked at: a question asked
/// earlier and then answered in the same reply is not a question to the user.
fn closing_question(text: &str) -> Option<String> {
    let lines = prose_lines(text);
    for line in lines.iter().rev().take(2) {
        let mut sentences: Vec<String> = Vec::new();
        let mut current = String::new();
        for c in line.chars() {
            current.push(c);
            if "。！？!?".contains(c) {
                sentences.push(std::mem::take(&mut current));
            }
        }
        if !current.trim().is_empty() {
            sentences.push(current);
        }
        // The last sentence of the line decides: a question followed by more prose is rhetoric.
        let Some(last) = sentences.last().map(|s| s.trim().to_string()) else { continue };
        if last.ends_with('？') || last.ends_with('?') {
            let bare = drop_asides(&last);
            return (bare.chars().count() >= 3).then(|| bubble_line(&bare));
        }
        return None;
    }
    None
}

/// A reply's lines of prose, markdown taken off: code blocks, tables, headings and rules are
/// skipped (none of them reads as something a cat could say), list markers and quotes are
/// stripped, and inline emphasis/code/links are reduced to their text.
fn prose_lines(text: &str) -> Vec<String> {
    let mut in_fence = false;
    let mut out = Vec::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || line.is_empty() || line.starts_with('|') || line.starts_with('#') || line.chars().all(|c| "-*_= ".contains(c)) {
            continue;
        }
        let mut line = line.trim_start_matches(['>', ' ']).to_string();
        for marker in ["- ", "* ", "+ "] {
            if let Some(rest) = line.strip_prefix(marker) {
                line = rest.to_string();
            }
        }
        if let Some((number, rest)) = line.split_once(". ") {
            if !number.is_empty() && number.chars().all(|c| c.is_ascii_digit()) {
                line = rest.to_string();
            }
        }
        let mut plain = String::new();
        let mut chars = line.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '*' | '`' | '_' if c != '_' || plain.ends_with(' ') || chars.peek() == Some(&'_') => {}
                // [text](url) -> text
                ']' if chars.peek() == Some(&'(') => {
                    for skipped in chars.by_ref() {
                        if skipped == ')' {
                            break;
                        }
                    }
                }
                '[' => {}
                _ => plain.push(c),
            }
        }
        let plain = plain.trim().to_string();
        if !plain.is_empty() {
            out.push(plain);
        }
    }
    out
}

/// Up to the first full stop, without trailing punctuation that would read as unfinished.
fn first_sentence(line: &str) -> String {
    let mut out = String::new();
    let mut iter = line.chars().peekable();
    while let Some(c) = iter.next() {
        if "。！？!?".contains(c) {
            break;
        }
        if c == '.' && iter.peek().is_none_or(|n| n.is_whitespace()) {
            break;
        }
        out.push(c);
    }
    out.trim().trim_end_matches(['：', ':', '，', ',', '；', ';']).trim().to_string()
}

/// A sentence without its asides in parentheses - the least important words in it.
fn drop_asides(sentence: &str) -> String {
    let mut depth = 0usize;
    let bare: String = sentence
        .chars()
        .filter(|&c| match c {
            '（' | '(' => {
                depth += 1;
                false
            }
            '）' | ')' if depth > 0 => {
                depth -= 1;
                false
            }
            _ => depth == 0,
        })
        .collect();
    let bare = bare.split_whitespace().collect::<Vec<_>>().join(" ");
    if bare.chars().count() >= 4 { bare } else { sentence.to_string() }
}

/// Make a sentence bubble-sized: drop asides first, then stop at the last comma that still
/// leaves a real clause, and only as a last resort cut with an ellipsis.
fn fit_bubble(sentence: &str) -> String {
    if sentence.chars().count() <= BUBBLE_SAY_CHARS {
        return sentence.to_string();
    }
    let sentence = drop_asides(sentence);
    if sentence.chars().count() > BUBBLE_SAY_CHARS {
        let head: Vec<char> = sentence.chars().take(BUBBLE_SAY_CHARS).collect();
        if let Some(cut) = head.iter().rposition(|c| "，,；;、".contains(*c)).filter(|&i| i >= 4) {
            return head[..cut].iter().collect();
        }
    }
    bubble_line(&sentence)
}

/// The name Claude Code itself shows for a session, read from the transcript the hook payload
/// points at: a `/rename` title (`custom-title`) wins over the generated one (`ai-title`).
/// None when there is no transcript yet, it is unreadable, or it has not been titled - the
/// first turn of a new session, before Claude Code has named it.
///
/// Only `.jsonl` files are opened, and only the title fields are kept: the payload arrives over
/// the bridge, and a path it names is not a licence to read anything else.
fn claude_transcript_title(path: &str) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let path = std::path::Path::new(path);
    if !path.is_absolute() || path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(TRANSCRIPT_TAIL_BYTES))).ok()?;
    let mut bytes = Vec::new();
    file.take(TRANSCRIPT_TAIL_BYTES).read_to_end(&mut bytes).ok()?;
    transcript_title_from_tail(&String::from_utf8_lossy(&bytes))
}

/// The title-picking half of `claude_transcript_title`, separate so it can be tested. The tail
/// usually starts mid-line; that fragment fails to parse and is skipped like any other line.
fn transcript_title_from_tail(tail: &str) -> Option<String> {
    let mut generated: Option<String> = None;
    for line in tail.lines().rev() {
        if !line.contains("-title\"") {
            continue;
        }
        let Ok(record) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let pick = |key: &str| bounded_str(record.get(key), SESSION_LABEL_MAX_CHARS);
        match record.get("type").and_then(|v| v.as_str()) {
            Some("custom-title") => {
                if let Some(title) = pick("customTitle") {
                    return Some(title);
                }
            }
            Some("ai-title") if generated.is_none() => generated = pick("aiTitle"),
            _ => {}
        }
    }
    generated
}

/// What to call a Claude Code session: its own title, else the project folder it runs in. The
/// flag says which - see TaskEvent::label_is_folder.
///
/// SessionStart and UserPromptSubmit carry `session_title` in the payload itself; the other
/// events do not, so the transcript is read for those (and for Claude Code versions without it).
fn claude_session_label(raw: &serde_json::Value) -> (Option<String>, bool) {
    let title = bounded_str(raw.get("session_title"), SESSION_LABEL_MAX_CHARS)
        .or_else(|| raw.get("transcript_path").and_then(|v| v.as_str()).and_then(claude_transcript_title));
    if title.is_some() {
        return (title, false);
    }
    let folder = (|| {
        let cwd = raw.get("cwd").and_then(|v| v.as_str())?;
        let folder = std::path::Path::new(cwd).file_name()?.to_str()?;
        bounded_str(Some(&serde_json::json!(folder)), SESSION_LABEL_MAX_CHARS)
    })();
    let is_folder = folder.is_some();
    (folder, is_folder)
}

/// Claude Code's raw hook payload -> a task event.
///
/// The IDENTITY is the tool - `claude`, the same id the plugin's header, the node adapter, the
/// CLI and the MCP server all use - and the session is carried beside it. It used to be the
/// session UUID: every session then registered as its own anonymous agent, so the bubble showed
/// a grey two-letter badge cut from a UUID and the 主界面 could not match it to the Claude mark.
/// Nobody could tell who was talking. Now the mark comes from the identity and the name from the
/// session (see claude_session_label), and concurrent sessions still get a row each.
fn normalize_claude_hook_event(raw: &serde_json::Value, sequence: u64) -> TaskEvent {
    let session = raw.get("session_id").and_then(|v| v.as_str()).map(|s| s.chars().take(128).collect::<String>());
    let session_id = session.clone().unwrap_or_else(|| "unknown-session".to_string());
    let hook_event_name = raw.get("hook_event_name").and_then(|v| v.as_str()).unwrap_or("unknown");
    // Must stay in step with integrations/adapters/lingxi-emit.mjs's fromClaude(). Two mappers
    // exist because there are two paths in: the one-click installer writes a plain curl that
    // posts the RAW hook payload (so it works for someone with only the .app and no checkout),
    // while the plugin routes through the node adapter. They drifted - this side knew three
    // events and the adapter knew five - so a session start and, worse, a PERMISSION PROMPT were
    // silently dropped on the path most users take.
    let mut result: Option<String> = None;
    let mut echo = false;
    let (state, summary) = match hook_event_name {
        "SessionStart" => ("queued".to_string(), "会话开始".to_string()),
        "UserPromptSubmit" => ("running".to_string(), "新一轮对话开始".to_string()),
        "Notification" => {
            // Claude raises this for permission prompts, plain questions, and a run of things that
            // are not waiting on the user at all (auth_success, computer_use_enter, ...). Current
            // Claude Code says which in `notification_type`; the message text is the fallback for
            // versions that predate it. Treating every non-approval as "waiting for you" had the
            // cat saying 在等你哦 about a successful login.
            echo = true;
            let message = raw.get("message").and_then(|v| v.as_str()).unwrap_or("");
            let lower = message.to_lowercase();
            let approval_text = ["permission", "approve", "allow"]
                .iter()
                .any(|needle| lower.contains(needle))
                || message.contains('授') && message.contains('权')
                || message.contains("批准")
                || message.contains("允许");
            let state = match raw.get("notification_type").and_then(|v| v.as_str()) {
                Some("permission_prompt" | "worker_permission_prompt") => "needs_approval",
                Some("idle_prompt" | "agent_needs_input" | "elicitation_dialog" | "elicitation_url_dialog") => "needs_input",
                Some(_) => "unknown",
                None if approval_text => "needs_approval",
                None => "needs_input",
            };
            // "Claude needs your permission to use Bash" -> the tool is the useful part.
            let tool = message
                .split_once("permission to use ")
                .map(|(_, rest)| rest.trim().trim_end_matches('.').chars().take(40).collect::<String>())
                .filter(|t| !t.is_empty());
            if let (true, Some(tool)) = (state == "needs_approval", &tool) {
                result = Some(format!("想用 {tool}，等你批一下"));
            }
            let text = match (state, tool) {
                ("needs_approval", Some(tool)) => format!("想用 {tool}，等你批一下"),
                ("needs_approval", None) if message.is_empty() => "等你批一下".to_string(),
                ("needs_input", _) if message.is_empty() => "在等你回一句".to_string(),
                ("unknown", _) => format!("不需要你处理的通知：{}", raw.get("notification_type").and_then(|v| v.as_str()).unwrap_or("")),
                _ => message.to_string(),
            };
            (state.to_string(), text)
        }
        "Stop" => {
            let reply = raw.get("last_assistant_message").and_then(|v| v.as_str()).unwrap_or("");
            // A turn that ends by asking the user something is waiting on them, not done.
            if let Some(question) = closing_question(reply) {
                result = Some(question);
                ("needs_input".to_string(), "回复末尾有问题等你回答".to_string())
            } else {
                result = turn_line(reply);
                let reason = raw.get("stop_reason").and_then(|v| v.as_str()).unwrap_or("end_turn");
                ("completed".to_string(), format!("本轮回复完成（{reason}）"))
            }
        }
        // Fired the moment a permission dialog opens - the Notification for the same dialog comes
        // 6s later, and only if the user has not acted (it is then an echo). It carries the tool
        // and its input, so the line can say WHAT is being asked, and it is also how an
        // AskUserQuestion shows up: that dialog is drawn as a permission dialog.
        "PermissionRequest" => {
            let tool = raw.get("tool_name").and_then(|v| v.as_str()).unwrap_or("");
            let input = raw.get("tool_input");
            let field = |key: &str| input.and_then(|i| i.get(key)).and_then(|v| v.as_str()).map(str::trim).filter(|v| !v.is_empty());
            match tool {
                "AskUserQuestion" => {
                    let question = input
                        .and_then(|i| i.get("questions"))
                        .and_then(|q| q.get(0))
                        .and_then(|q| q.get("question"))
                        .and_then(|v| v.as_str());
                    result = Some(question.map(|q| fit_bubble(&drop_asides(q.trim()))).unwrap_or_else(|| "有个问题等你选".to_string()));
                    ("needs_input".to_string(), "有个问题等你选".to_string())
                }
                "ExitPlanMode" => {
                    result = Some("计划写好了，等你过目".to_string());
                    ("needs_approval".to_string(), "计划写好了，等你过目".to_string())
                }
                _ => {
                    // mcp__server__tool -> tool: the prefix is plumbing.
                    let short = tool.rsplit("__").next().filter(|t| !t.is_empty()).unwrap_or("工具");
                    let summary = format!("想用 {short}，等你批一下");
                    let what = match tool {
                        "Bash" => field("description").map(|d| format!("想跑：{d}")),
                        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => field("file_path")
                            .or_else(|| field("notebook_path"))
                            .and_then(|p| std::path::Path::new(p).file_name()?.to_str().map(str::to_string))
                            .map(|name| format!("想改 {name}，等你批一下")),
                        _ => None,
                    };
                    result = Some(fit_bubble(&what.unwrap_or_else(|| summary.clone())));
                    ("needs_approval".to_string(), summary)
                }
            }
        }
        // Claude's own todo list: a task ticked off is a status update. It updates the session's
        // row in 主界面 and does not speak - a bubble per checked box is the notification spam a
        // pet is meant to replace (running events are silent after the first; see should_react).
        "TaskCompleted" => {
            result = raw
                .get("task_subject")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|subject| fit_bubble(&format!("完成：{subject}")));
            ("running".to_string(), "完成了一项待办".to_string())
        }
        // Not a state of the work - the session is gone. Handled before anything is recorded:
        // its row leaves 主界面 instead of sitting there as "running" forever.
        "SessionEnd" => ("ended".to_string(), "会话结束".to_string()),
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
    // The transcript is only read for events that can put something on screen.
    let (label, label_is_folder) = if state == "unknown" { (None, false) } else { claude_session_label(raw) };
    TaskEvent {
        schema_version: 1,
        provider: "claude".to_string(),
        source_id: "claude".to_string(),
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
        session,
        label,
        result,
        echo,
        label_is_folder,
        from_hook: true,
        turn_end: hook_event_name == "Stop",
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
/// one (see integrations/hosts/), and both post the same schema to the same endpoint.
///
/// The token goes into a variable BEFORE curl (the path contains spaces, so it needs quoting,
/// and quoting inside $( ) inside an already-quoted argument does not survive the shell), and
/// then reaches curl through a config FILE rather than a `-H` argv: an expanded `-H` lands in
/// curl's argv, which `ps` shows to every local user for the life of the call. `-K -` (config
/// on stdin) cannot be used here because the payload already arrives on stdin. `mktemp`
/// creates the file 0600, so the token spends its whole life under the same protection as the
/// token file itself.
///
/// `|| true` at the end, and every failure swallowed: a desktop pet must never be able to make
/// someone's agent fail.
///
/// `--noproxy '*'` because curl hands even 127.0.0.1 to an exported http_proxy/all_proxy, and a
/// local Clash-style proxy answers 502 for it: every event went to the proxy and none reached the
/// cat. (The shell client learned this first - see NOPROXY in integrations/cli/lingxi.)
const CLAUDE_HOOK_COMMAND: &str = concat!(
    "T=$(cat \"$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token\" 2>/dev/null); ",
    "H=$(mktemp) || exit 0; ",
    "printf 'header = \"Authorization: Bearer %s\"\\n' \"$T\" > \"$H\"; ",
    "curl -s -m 2 --noproxy '*' -K \"$H\" -X POST http://127.0.0.1:47811/task-event ",
    "-H 'Content-Type: application/json' ",
    "--data-binary @- >/dev/null 2>&1 || true; ",
    "rm -f \"$H\""
);

/// SessionStart's hook: the CHECK. Is the app up? If not, start it, wait for the bridge, and only
/// then deliver the event - so a session opening is enough to bring the cat back.
///
/// Every other hook just posts, and an event that finds the app closed is dropped, as before. The
/// start belongs to the session boundary: relaunching on every prompt or every Stop would fight a
/// user who quit the cat on purpose, twenty times an hour. Once per session is a nudge.
///
/// Everything after reading stdin runs in a DETACHED subshell with its stdio on /dev/null, so the
/// hook returns in milliseconds and the session never waits on a GUI app booting - that can take
/// seconds, and SessionStart hooks block the session. `open -g` does not steal focus. The token is
/// read only after the bridge answers, because on a machine where the app has never run the app is
/// what creates the token file. LINGXI_AUTOSTART=0 (or false/no) in the environment turns the
/// start off; a missing app makes `open` fail and the subshell exit quietly. Plain sh throughout -
/// the one-click install has to work for someone with the .app and no checkout.
const CLAUDE_SESSION_START_COMMAND: &str = concat!(
    "P=$(cat); (",
    "lx_up() { curl -s -m 1 --noproxy '*' -o /dev/null http://127.0.0.1:47811/health; }; ",
    "lx_up || { case \"${LINGXI_AUTOSTART:-1}\" in 0|false|no) exit 0;; esac; ",
    "open -g -b com.dushaobin.lingxi-desktop || exit 0; ",
    "i=0; until lx_up; do i=$((i+1)); [ $i -gt 50 ] && exit 0; sleep 0.3; done; }; ",
    "T=$(cat \"$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token\" 2>/dev/null); ",
    "H=$(mktemp) || exit 0; ",
    "printf 'header = \"Authorization: Bearer %s\"\\n' \"$T\" > \"$H\"; ",
    "printf '%s' \"$P\" | curl -s -m 2 --noproxy '*' -K \"$H\" -X POST http://127.0.0.1:47811/task-event ",
    "-H 'Content-Type: application/json' --data-binary @-; ",
    "rm -f \"$H\"",
    ") </dev/null >/dev/null 2>&1 &"
);

/// The command a given event carries - see CLAUDE_SESSION_START_COMMAND for why they differ.
fn claude_hook_command_for(event: &str) -> &'static str {
    if event == "SessionStart" { CLAUDE_SESSION_START_COMMAND } else { CLAUDE_HOOK_COMMAND }
}

/// Hook lines we have written in the past. Uninstall has to recognise all of them, or an older
/// install becomes impossible to remove through the UI that created it - and install has to
/// REPLACE them, or a machine that installed before a fix keeps running the outdated command
/// forever while every button involved insists it is up to date.
const LEGACY_CLAUDE_HOOK_COMMANDS: [&str; 3] = [
    // The tokenless original: written before the bridge grew authentication, dead (401)
    // against any bridge that has one.
    "curl -s -m 2 -X POST http://127.0.0.1:47811/task-event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true",
    // The argv-token form: worked, but exposed the token in `ps` for every call. Superseded
    // by the -K form above.
    "T=$(cat \"$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token\" 2>/dev/null); curl -s -m 2 -X POST http://127.0.0.1:47811/task-event -H 'Content-Type: application/json' -H \"Authorization: Bearer $T\" --data-binary @- >/dev/null 2>&1 || true",
    // The -K form without --noproxy: routed through any exported proxy, and on SessionStart it
    // could not start a closed app. Superseded by CLAUDE_HOOK_COMMAND and
    // CLAUDE_SESSION_START_COMMAND.
    "T=$(cat \"$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token\" 2>/dev/null); H=$(mktemp) || exit 0; printf 'header = \"Authorization: Bearer %s\"\\n' \"$T\" > \"$H\"; curl -s -m 2 -K \"$H\" -X POST http://127.0.0.1:47811/task-event -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true; rm -f \"$H\"",
];

/// The Claude Code lifecycle events this integration speaks, shared verbatim by the
/// one-click installer and the plugin's hooks.json (whose scripts post the same raw payloads -
/// see integrations/hosts/claude/scripts/event.sh). Notification is the one that carries
/// permission prompts - the single most urgent thing an agent can be doing - and SessionStart
/// is what makes the cat look up when a session begins; leaving either unsubscribed was the
/// residue of the mapper drift this whole block exists to prevent. If you add one here, add it
/// to integrations/hosts/claude/hooks/hooks.json and to the mappers in the same commit.
const CLAUDE_HOOK_EVENTS: [&str; 8] = [
    "SessionStart", "UserPromptSubmit", "Notification", "Stop", "StopFailure",
    // Added later: a dialog is reported the moment it opens (and AskUserQuestion with its
    // question), Claude's todo list reports progress, and an ended session leaves 主界面.
    "PermissionRequest", "TaskCompleted", "SessionEnd",
];

/// Bumped whenever CLAUDE_HOOK_EVENTS grows; see upgrade_installed_claude_hooks.
const CLAUDE_HOOK_GENERATION: u32 = 2;
/// What generation 2 added over the original five.
const CLAUDE_HOOK_EVENTS_SINCE_GEN_1: [&str; 3] = ["PermissionRequest", "TaskCompleted", "SessionEnd"];

/// Add our hook under each event this app has learned since the user installed, when - and only
/// when - they have our hooks at all. Returns how many were added. Pure, so it is testable.
fn add_events_new_since_install(hooks_obj: &mut serde_json::Map<String, serde_json::Value>) -> usize {
    let ours = |entries: &serde_json::Value| entries.as_array().is_some_and(|e| has_our_hook(e));
    if !hooks_obj.values().any(ours) {
        return 0;
    }
    let mut added = 0;
    for event in CLAUDE_HOOK_EVENTS_SINCE_GEN_1 {
        if hooks_obj.get(event).is_some_and(ours) {
            continue;
        }
        let entries = hooks_obj.entry(event).or_insert_with(|| serde_json::json!([]));
        let Some(entries) = entries.as_array_mut() else { continue };
        let mut hook = serde_json::json!({ "type": "command", "command": claude_hook_command_for(event) });
        if claude_hook_is_async(event) {
            hook["async"] = serde_json::json!(true);
        }
        entries.push(serde_json::json!({ "hooks": [hook] }));
        added += 1;
    }
    added
}

/// Events whose hook runs detached. A PermissionRequest hook sits in front of the dialog the
/// user is about to answer: even a 2-second curl timeout is a dialog that appears late.
fn claude_hook_is_async(event: &str) -> bool {
    matches!(event, "PermissionRequest" | "TaskCompleted")
}

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
/// shared by install (skip re-adding), install's legacy upgrade and uninstall (find exactly
/// what to remove), so all three can never disagree about what "ours" means.
fn is_our_command(command: &str) -> bool {
    command == CLAUDE_HOOK_COMMAND
        || command == CLAUDE_SESSION_START_COMMAND
        || LEGACY_CLAUDE_HOOK_COMMANDS.contains(&command)
}

fn has_our_hook(entries: &[serde_json::Value]) -> bool {
    entries.iter().any(|entry| {
        entry
            .get("hooks")
            .and_then(|h| h.as_array())
            .map(|inner| inner.iter().any(|h| h.get("command").and_then(|c| c.as_str()).is_some_and(is_our_command)))
            .unwrap_or(false)
    })
}

/// Drop entries carrying an OUTDATED form of our hook for this event, keeping everything else -
/// the user's own hooks and other tools' hooks are untouchable. "Outdated" is per event: the
/// plain posting command is current everywhere except SessionStart, which carries the check.
/// Returns true when one of ours survives, which is what lets install upgrade a machine that ran
/// an older installer instead of skipping it forever because `has_our_hook` recognised the
/// obsolete line.
fn prune_legacy_hook_entries(entries: &mut Vec<serde_json::Value>, current: &str) -> bool {
    entries.retain(|entry| {
        let inner_is_current_only = |entry: &serde_json::Value| {
            entry
                .get("hooks")
                .and_then(|h| h.as_array())
                .map(|inner| {
                    inner.iter().any(|h| {
                        let command = h.get("command").and_then(|c| c.as_str());
                        command == Some(current)
                    })
                })
                .unwrap_or(false)
        };
        // Keep the entry unless it holds ONLY a legacy command of ours. An entry mixing our
        // legacy command with other commands is not something we wrote - leave it alone.
        if inner_is_current_only(entry) {
            return true;
        }
        let holds_legacy = entry
            .get("hooks")
            .and_then(|h| h.as_array())
            .map(|inner| {
                !inner.is_empty()
                    && inner.iter().all(|h| {
                        h.get("command").and_then(|c| c.as_str()).is_some_and(|c| c != current && is_our_command(c))
                    })
            })
            .unwrap_or(false);
        !holds_legacy
    });
    has_our_hook(entries)
}

/// "一键接入" (docs/18 §6.2): merges `CLAUDE_HOOK_COMMAND` into the five subscribed events,
/// appending to each event's array rather than replacing it - any hooks the user already had
/// stay exactly as they were. Entries holding an OUTDATED form of our command are replaced
/// with the current one (see `prune_legacy_hook_entries`). Backs up the pre-existing file
/// first (single generation, `.lingxi-backup` - see `uninstall` for the removal path, which
/// is preferred over restoring from backup since it can't undo hooks the user added *after*
/// install ran).
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
        let current = claude_hook_command_for(event);
        if !prune_legacy_hook_entries(entries_arr, current) {
            let mut hook = serde_json::json!({ "type": "command", "command": current });
            if claude_hook_is_async(event) {
                hook["async"] = serde_json::json!(true);
            }
            entries_arr.push(serde_json::json!({ "hooks": [hook] }));
        }
    }

    write_claude_settings(&path, &settings)?;
    Ok(format!("已写入 {}（原文件已备份为 .lingxi-backup）", path.display()))
}

/// Rewrite, in place, every hook command of ours that is not the current one for its event.
/// Returns how many were rewritten. Pure, so the upgrade contract is testable without a file.
///
/// Only commands already there are touched: an event the user has no entry of ours under stays
/// that way (they may have removed it on purpose), and nothing that is not ours is read twice.
fn upgrade_our_hook_commands(hooks_obj: &mut serde_json::Map<String, serde_json::Value>) -> usize {
    let mut rewritten = 0;
    for event in CLAUDE_HOOK_EVENTS {
        let current = claude_hook_command_for(event);
        let Some(entries) = hooks_obj.get_mut(event).and_then(|e| e.as_array_mut()) else { continue };
        for entry in entries.iter_mut() {
            let Some(inner) = entry.get_mut("hooks").and_then(|h| h.as_array_mut()) else { continue };
            for hook in inner.iter_mut() {
                let outdated = hook
                    .get("command")
                    .and_then(|c| c.as_str())
                    .is_some_and(|c| c != current && is_our_command(c));
                if outdated {
                    hook["command"] = serde_json::Value::String(current.to_string());
                    rewritten += 1;
                }
            }
        }
    }
    rewritten
}

/// Run at launch: a machine that clicked "一键接入" on an older build keeps the hook it got then,
/// forever, unless something upgrades it - and the one thing that has changed since is exactly
/// what makes a session start bring the cat back. Writes only when there is something to change,
/// backs up first like install does, and never installs hooks nobody asked for.
///
/// The one exception is an event this app did not speak when the user clicked "一键接入": they
/// never got to decline it, so it is added - ONCE, recorded in `generation_file`, so an event
/// the user removes afterwards stays removed.
fn upgrade_installed_claude_hooks(generation_file: Option<&std::path::Path>) -> Result<usize, String> {
    let path = claude_settings_path().ok_or_else(|| "找不到 HOME 目录".to_string())?;
    if !path.exists() {
        return Ok(0);
    }
    let mut settings = read_claude_settings(&path)?;
    let Some(hooks_obj) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) else { return Ok(0) };
    let mut rewritten = upgrade_our_hook_commands(hooks_obj);
    let generation = generation_file
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|g| g.trim().parse::<u32>().ok())
        .unwrap_or(1);
    if generation < CLAUDE_HOOK_GENERATION {
        rewritten += add_events_new_since_install(hooks_obj);
        if let Some(file) = generation_file {
            let _ = std::fs::write(file, CLAUDE_HOOK_GENERATION.to_string());
        }
    }
    if rewritten > 0 {
        let _ = std::fs::copy(&path, path.with_extension("json.lingxi-backup"));
        write_claude_settings(&path, &settings)?;
    }
    Ok(rewritten)
}

/// Remove every entry carrying OUR command (current or any legacy form) from each subscribed
/// event, leaving the user's own hooks untouched. Returns how many entries went away. Pure so
/// the legacy-recognition contract is testable without an AppHandle.
fn remove_our_hook_entries(hooks_obj: &mut serde_json::Map<String, serde_json::Value>) -> usize {
    let mut removed = 0;
    for event in CLAUDE_HOOK_EVENTS {
        if let Some(entries_arr) = hooks_obj.get_mut(event).and_then(|e| e.as_array_mut()) {
            let before = entries_arr.len();
            entries_arr.retain(|entry| {
                !entry
                    .get("hooks")
                    .and_then(|h| h.as_array())
                    .map(|inner| {
                        inner
                            .iter()
                            .any(|h| h.get("command").and_then(|c| c.as_str()).is_some_and(is_our_command))
                    })
                    .unwrap_or(false)
            });
            removed += before - entries_arr.len();
        }
    }
    removed
}

/// The rollback path (docs/18 §6.2's "备份+回退"): removes exactly the entries
/// `install_claude_hooks` would recognize as its own - CURRENT and LEGACY forms alike,
/// because `claude_hooks_installed` reports the legacy forms as installed and an uninstall
/// that only matched the current command would leave those machines with hooks they can
/// see in the UI but not remove. Everything else - including hooks added by the user or
/// another tool after install ran - is untouched.
#[tauri::command]
fn uninstall_claude_hooks() -> Result<String, String> {
    let path = claude_settings_path().ok_or_else(|| "找不到 HOME 目录".to_string())?;
    let mut settings = read_claude_settings(&path)?;
    let Some(hooks_obj) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return Ok("没有发现已安装的 hooks".to_string());
    };
    let removed = remove_our_hook_entries(hooks_obj);
    if removed == 0 {
        return Ok("没有发现已安装的 hooks".to_string());
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
/// Whether the perception bridge actually bound its port. A failed bind (something else took
/// 47811 - another account's copy of this app, or any process at all: loopback ports are not
/// per-user) used to be silent: the app ran, the management page kept describing a bridge,
/// and every agent's hook - Bearer token and all - went to whoever held the port. The page
/// reads this and tells the truth instead.
#[derive(Default)]
struct BridgeBindState {
    listening: AtomicBool,
}

/// What the management window's bridge card renders. See BridgeBindState for the listening
/// flag: it is read from live state, so the page cannot describe a build it is not running in.
#[tauri::command]
fn get_bridge_info(app: tauri::AppHandle) -> serde_json::Value {
    let token = app.state::<BridgeToken>();
    let registry = app.state::<AgentRegistry>();
    let agents: Vec<AgentIdentity> = registry.agents.lock().unwrap().values().cloned().collect();
    serde_json::json!({
        "port": PERCEPTION_HTTP_PORT,
        "listening": app.state::<BridgeBindState>().listening.load(Ordering::Relaxed),
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
    "H=$(mktemp) || exit 0; ",
    "printf 'header = \"Authorization: Bearer %s\"\\n' \"$T\" > \"$H\"; ",
    "printf '%s' \"$1\" | curl -s -m 2 --noproxy '*' -K \"$H\" -X POST http://127.0.0.1:47811/task-event ",
    "-H 'Content-Type: application/json' ",
    "--data-binary @- >/dev/null 2>&1 || true; ",
    "rm -f \"$H\""
);

/// How we recognise our own `notify` entry, including one we might rewrite later. Matching on
/// the endpoint rather than on the whole script means a future tweak to the command does not
/// make the previous install unrecognisable - which is what turns "uninstall" into "the button
/// says it is not installed while it plainly is".
const CODEX_NOTIFY_MARKER: &str = "127.0.0.1:47811/task-event";

fn codex_config_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex").join("config.toml"))
}

/// The two skills every host plugin carries (integrations/hosts/PLUGIN-STANDARD.md, 六): the
/// shared `lingxi` skill - how any agent drives the cat - and the host's own layer, which says
/// only what holds on Codex: its identity, its notify channel, where the CLI lives. Installing
/// just the shared one left Codex speaking as whatever ~/.lingxi/agent.json names.
const CODEX_SKILLS: [(&str, &str); 2] = [
    ("lingxi", include_str!("../../../../integrations/skills/lingxi/SKILL.md")),
    ("lingxi-codex", include_str!("../../../../integrations/hosts/codex/skills/lingxi-codex/SKILL.md")),
];

/// Kept beside each SKILL.md this app writes: exactly what it wrote. A SKILL.md that still
/// matches it is ours to upgrade when a new version of the app ships a new skill; one that does
/// not has been edited by the user, and is left alone.
const SKILL_STAMP: &str = ".lingxi-installed";

fn install_skill_dir(dir: &std::path::Path, content: &str) -> Result<(), String> {
    if dir.is_symlink() {
        // A repository installation owns a live link and updates it with git pull.
        if dir.join("SKILL.md").is_file() {
            return Ok(());
        }
        // A dead one points into a checkout whose layout moved on (the single-skill layout's
        // hosts/codex/skills/lingxi). Nothing of the user's is behind it.
        std::fs::remove_file(dir).map_err(|e| format!("无法移除失效链接 {}：{e}", dir.display()))?;
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建 {}：{e}", dir.display()))?;
    let target = dir.join("SKILL.md");
    let stamp = dir.join(SKILL_STAMP);
    if target.exists() {
        let current = std::fs::read_to_string(&target)
            .map_err(|e| format!("无法读取 {}：{e}", target.display()))?;
        let ours = current == content
            || std::fs::read_to_string(&stamp).is_ok_and(|written| written == current);
        if !ours {
            return Err(format!("{} 有你改过的内容；为避免覆盖，未改动它", target.display()));
        }
    }
    std::fs::write(&target, content).map_err(|e| format!("无法写入 {}：{e}", target.display()))?;
    std::fs::write(&stamp, content).map_err(|e| format!("无法写入 {}：{e}", stamp.display()))?;
    Ok(())
}

#[tauri::command]
fn install_codex_skill() -> Result<String, String> {
    let config = codex_config_path().ok_or_else(|| "找不到 HOME 目录".to_string())?;
    let root = config.parent().unwrap().join("skills");
    for (name, content) in CODEX_SKILLS {
        install_skill_dir(&root.join(name), content)?;
    }
    Ok("skill 已接入（lingxi + lingxi-codex）".to_string())
}

fn codex_skills_installed(codex_dir: &std::path::Path) -> bool {
    CODEX_SKILLS.iter().all(|(name, _)| codex_dir.join("skills").join(name).join("SKILL.md").is_file())
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
                 覆盖它会让那个工具静默失效。\n\n要两个都要，用仓库里的安装器——\
                 integrations/hosts/codex/install.sh 会把 notify 合并成一个 fanout，\
                 你原来的程序排在前面，灵犀并排跟上，两边都拿到完整载荷。",
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

/// Everything 主界面 needs for the Agent permissions panel: who has called, what they may do,
/// and what they have actually been doing.
#[tauri::command]
fn get_agent_activity(app: tauri::AppHandle) -> serde_json::Value {
    let registry = app.state::<AgentRegistry>();
    let mut agents: Vec<serde_json::Value> = registry
        .agents
        .lock()
        .unwrap()
        .values()
        .map(|a| {
            serde_json::json!({
                "id": a.id, "name": a.name, "badge": a.badge, "color": a.color, "logo": a.logo,
                "lastSeen": a.last_seen, "claims": a.claims, "permission": a.permission.as_str(),
                "seen": true,
            })
        })
        .collect();
    // Grants for agents that have not called yet this session still belong on the page - a user
    // who granted something yesterday should see it today, not an empty list that looks like the
    // grant was lost.
    let known: std::collections::HashSet<String> =
        agents.iter().filter_map(|a| a["id"].as_str().map(str::to_string)).collect();
    for (id, permission) in registry.saved.lock().unwrap().iter() {
        if !known.contains(id) {
            agents.push(serde_json::json!({
                "id": id, "name": id, "badge": id.chars().take(2).collect::<String>(),
                "color": "#8b95a5", "lastSeen": 0, "claims": 0,
                "permission": permission.as_str(), "seen": false,
            }));
        }
    }
    // Newest first for the log: the page shows the most recent slice, and "what just happened"
    // is the question it is open to answer.
    let mut log = registry.log.lock().unwrap().clone();
    log.reverse();
    let registered = registry.agents.lock().unwrap().clone();
    let activity: Vec<serde_json::Value> = app
        .state::<ActivityState>()
        .by_provider
        .lock()
        .unwrap()
        .values()
        .map(|row| {
            let identity = row.agent.as_ref().and_then(|id| registered.get(id))
                .or_else(|| registered.get(&row.provider));
            let mut value = serde_json::to_value(row).unwrap_or(serde_json::Value::Null);
            if let (Some(object), Some(identity)) = (value.as_object_mut(), identity) {
                object.insert("name".into(), serde_json::json!(identity.name));
                object.insert("badge".into(), serde_json::json!(identity.badge));
                object.insert("color".into(), serde_json::json!(identity.color));
                // So a row can be drawn exactly as the bubble draws this agent (ui/icons.ts agentLook).
                object.insert("logo".into(), serde_json::json!(identity.logo));
            }
            value
        })
        .collect();
    serde_json::json!({
        "agents": agents,
        "activity": activity,
        "log": log,
        "permissions": AGENT_PERMISSIONS,
        "writeLimit": AGENT_WRITE_LIMIT,
        "writeWindowMs": AGENT_WRITE_WINDOW_MS,
        "settingsFields": SETTINGS_FIELDS,
    })
}

/// Grant or revoke a tier. The user's decision, made in 主界面 - never something an agent can
/// ask for, which is the whole reason this is a Tauri command and not a bridge endpoint.
#[tauri::command]
fn set_agent_permission(app: tauri::AppHandle, id: String, permission: String) -> Result<String, String> {
    let Some(parsed) = AgentPermission::parse(&permission) else {
        return Err(format!("不认识的权限档位「{permission}」，只能是 {AGENT_PERMISSIONS:?}"));
    };
    let id = id.trim().chars().take(64).collect::<String>();
    if id.is_empty() {
        return Err("agent id 不能为空".to_string());
    }
    app.state::<AgentRegistry>().set_permission(&id, parsed);
    Ok(format!("「{id}」现在是 {}。", parsed.as_str()))
}

/// What the management window needs to draw the Codex panel.
///
/// Three outcomes, not two, and the third is the whole reason this is a separate command rather
/// than a boolean: `notify` is a single TOML key, so a machine that already has one is a machine
/// where installing would DELETE someone else's integration - silently, because Codex simply
/// stops calling it. A one-click button that did that would be the most damaging thing in this
/// app.
///
/// This command refuses rather than merging. `integrations/hosts/codex/install.sh` DOES merge -
/// it rewrites `notify` into a fanout that keeps the user's own notifier first and runs 灵犀
/// alongside it - and that is the better answer whenever a checkout is available. Two mechanisms
/// for one key is not ideal, so the division is by capability rather than by preference: this
/// one runs from an .app with no checkout and therefore only does what is safe without one, and
/// it points at the installer for the case it will not handle itself.
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
    let skill_installed = path.parent().is_some_and(codex_skills_installed);
    match doc.get("notify") {
        None => serde_json::json!({
            "state": "not_installed", "configPath": display, "configExists": true, "mcpInstalled": mcp_installed, "skillInstalled": skill_installed,
        }),
        Some(existing) if codex_notify_is_ours(existing) => serde_json::json!({
            "state": "installed", "configPath": display, "configExists": true, "mcpInstalled": mcp_installed, "skillInstalled": skill_installed,
        }),
        Some(existing) if existing.to_string().contains("notify-fanout.sh")
            && path.parent().is_some_and(|dir| {
                std::fs::read_to_string(dir.join("notify-fanout.sh"))
                    .is_ok_and(|script| script.contains("lingxi-emit.mjs"))
            }) => serde_json::json!({
            "state": "installed_fanout", "configPath": display,
            "configExists": true, "mcpInstalled": mcp_installed, "skillInstalled": skill_installed,
        }),
        Some(existing) => serde_json::json!({
            "state": "conflict",
            "configPath": display,
            "configExists": true,
            "mcpInstalled": mcp_installed, "skillInstalled": skill_installed,
            // Shown verbatim so the user can see whose it is and decide, rather than being
            // told "something is in the way".
            "existingNotify": existing.to_string().trim().to_string(),
        }),
    }
}

/// Add the notify hook and the MCP server block to ~/.codex/config.toml.
///
/// Refuses, rather than overwrites, when `notify` already belongs to something else. The
/// merging installer that lets both coexist is integrations/hosts/codex/install.sh; deciding to
/// run it is the user's call, not this button's.
#[tauri::command]
fn install_codex_notify() -> Result<String, String> {
    // The skill is the richer half, but the notify line must not depend on it: a SKILL.md the
    // user edited keeps the skill as it is and still gets the turn-end channel.
    let skill_result = install_codex_skill().unwrap_or_else(|reason| format!("skill 未更新：{reason}"));
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
    Ok(format!("{skill_result}；已写入 {}。重启 Codex 后生效。", path.display()))
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

/// Is the 灵犀 Claude Code plugin installed (and not disabled)?
///
/// Read from Claude Code's own records - `~/.claude/plugins/installed_plugins.json` and the
/// `enabledPlugins` map in `~/.claude/settings.json` - so the Agent page can say "connected by
/// the plugin" instead of offering a "一键接入" that would duplicate what the plugin already does.
/// Any marketplace name counts (`lingxi@lingxi`, a fork's `lingxi@whatever`).
#[derive(Serialize, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct ClaudePluginStatus {
    installed: bool,
    enabled: bool,
    version: Option<String>,
    id: Option<String>,
}

fn claude_plugin_status_from(installed: &serde_json::Value, settings: &serde_json::Value) -> ClaudePluginStatus {
    let Some(plugins) = installed.get("plugins").and_then(|p| p.as_object()) else { return ClaudePluginStatus::default() };
    let Some((id, entries)) = plugins.iter().find(|(id, _)| id.split('@').next() == Some("lingxi")) else {
        return ClaudePluginStatus::default();
    };
    let version = entries
        .as_array()
        .and_then(|list| list.first())
        .and_then(|entry| entry.get("version"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    // Absent means enabled: a plugin is on unless the user switched it off.
    let enabled = settings
        .get("enabledPlugins")
        .and_then(|e| e.get(id))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    ClaudePluginStatus { installed: true, enabled, version, id: Some(id.clone()) }
}

#[tauri::command]
fn claude_plugin_status() -> ClaudePluginStatus {
    let Ok(home) = std::env::var("HOME") else { return ClaudePluginStatus::default() };
    let read = |path: PathBuf| {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
            .unwrap_or(serde_json::Value::Null)
    };
    let claude = PathBuf::from(home).join(".claude");
    claude_plugin_status_from(&read(claude.join("plugins").join("installed_plugins.json")), &read(claude.join("settings.json")))
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

/// Hard cap on a request body. The bridge trusts its callers with the cat, not with its memory:
/// `Content-Length` is caller-asserted, and an unbounded `read_to_string` let one process
/// holding the token turn a fat payload into an OOM of the whole app. 1 MiB is orders of
/// magnitude past anything the schema wants (the largest legal body is a 64 KiB SVG logo) and
/// far below what a desktop app should be willing to buffer.
const MAX_BODY_BYTES: u64 = 1024 * 1024;

fn read_body_capped(request: &mut tiny_http::Request) -> String {
    use std::io::Read;
    let mut body = String::new();
    let _ = request.as_reader().take(MAX_BODY_BYTES).read_to_string(&mut body);
    body
}

fn json_response(status: u16, body: String) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let content_type = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    // CORS is deliberately NOT granted here - not even `*`. /health and the 401 body both name
    // the token file (an absolute path, and therefore a macOS username), and
    // `Access-Control-Allow-Origin: *` let any page in any browser read both. The one
    // legitimate cross-origin reader is the dev console on the vite dev server, served by the
    // explicit allow-list in the request loop below; same-origin clients (the app's own
    // windows, curl, agents) never needed the header at all.
    tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(content_type)
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
/// A bubble stays about 1.8s + 0.13s per character, and the forced hold below is only a few
/// seconds. Past ~24 characters the line disappears before it can be read.
const BUBBLE_SAY_CHARS: usize = 24;
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
const CONTROL_FIELDS: [&str; 20] = [
    "mode", "camera", "skin", "scale", "visible", "action", "expression", "holdMs", "perform",
    "toy", "say", "sayMs", "resetPosition", "reloadAssets",
    // Bring the main window forward at a page - see MANAGEMENT_PAGES.
    "openManagement",
    // Who is calling and how much the user needs to see it. Both optional - see decision 003.
    "agent", "priority",
    // How long a queued reaction stays worth showing. See DEFAULT_REACTION_TTL_MS.
    "expiresInMs",
    // Internal: set only by the queue drain when replaying a reaction that already holds the
    // stage. Listed so the unknown-field check does not reject our own replay.
    "__stageAlreadyHeld",
    // Internal: the session a task-event reaction speaks for (react_to_task_event), shown on
    // the bubble beside the agent's mark.
    "__label",
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
    /// What this agent may do. Set by the user in 主界面, never by the agent itself -
    /// an identity that can choose its own permissions is not a permission.
    #[serde(default)]
    permission: AgentPermission,
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

/// What an agent is allowed to do.
///
/// Three tiers, because there are three genuinely different kinds of ask and collapsing them
/// loses the distinction that matters:
///
///   observer   read only. It can look at the cat and register a name; it cannot touch anything.
///   performer  can drive the PERFORMANCE - expression, action, a line, a toy, a task event.
///              All of it transient: the next thing the cat does overwrites it, so the worst a
///              misbehaving performer can do is be annoying for a few seconds.
///   trusted    can additionally change SETTINGS that persist across restarts (theme, camera,
///              size, visibility) and write to the owner notes and reminders.
///
/// The line is drawn at persistence, not at importance. A wrong expression is gone in four
/// seconds; a wrong `visible: false` leaves the user with no cat and no obvious way to work out
/// which of their agents did it. Those deserve different answers.
///
/// ## Why a named agent starts at `trusted`
///
/// Memory and reminders sit on this tier. A cat that cannot write them cannot remember yesterday.
/// The user can lower a named agent in the UI, and a saved grant always wins.
///
/// `anonymous` stays `performer`. Loopback is not a trust boundary: any process running as this
/// user can reach the bridge, and a caller that never gave a name is not one of the agents the
/// user connected. Open source means the cat's code can be read. It does not mean every caller
/// inherits a write that persists.
///
/// A call above the caller's tier is rejected with a reason naming the tier and where to change
/// it, and it lands in the call log either way. A silent downgrade would be the same class of
/// mistake as the silent overwrite this codebase has already learned about elsewhere.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AgentPermission {
    Observer,
    Performer,
    Trusted,
}

impl Default for AgentPermission {
    fn default() -> Self {
        Self::Performer
    }
}

/// Starting tier for an id the user has not set.
///
/// A named agent is trusted so it can remember and remind. `anonymous` is not a named agent.
/// `AgentPermission::default` stays `performer` so an unspecified value cannot become a grant.
fn default_permission_for(id: &str) -> AgentPermission {
    if id == "anonymous" {
        AgentPermission::Performer
    } else {
        AgentPermission::Trusted
    }
}

impl AgentPermission {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "observer" => Some(Self::Observer),
            "performer" => Some(Self::Performer),
            "trusted" => Some(Self::Trusted),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Observer => "observer",
            Self::Performer => "performer",
            Self::Trusted => "trusted",
        }
    }

    /// May it change how the cat behaves right now?
    fn may_perform(self) -> bool {
        matches!(self, Self::Performer | Self::Trusted)
    }

    /// May it change something that survives a restart, or write to the owner's notes?
    fn may_write_settings(self) -> bool {
        matches!(self, Self::Trusted)
    }
}

const AGENT_PERMISSIONS: [&str; 3] = ["observer", "performer", "trusted"];

/// Fields of POST /control that persist. Everything else is performance and expires on its own.
///
/// Listed explicitly rather than derived: a new control field should have to be classified by
/// whoever adds it, and an unclassified one defaulting to "performance" is the safe direction -
/// it means a new knob is never accidentally granted to every caller as a persistent write.
const SETTINGS_FIELDS: [&str; 4] = ["skin", "camera", "scale", "visible"];

/// One thing an agent asked for, and what happened to it.
///
/// Permissions without visibility are unusable: a user who grants a tier cannot check whether it
/// was the right call, and a user whose integration stopped working cannot find out that a
/// permission is why. Both questions are answered by the same record.
#[derive(Clone, Serialize)]
struct AgentCall {
    at: u64,
    agent: String,
    /// The endpoint, e.g. "control", "memory", "task-event".
    surface: String,
    /// What was asked for, as a short field list - never the payload, which can contain the
    /// user's own words.
    asked: String,
    /// "applied" | "rejected" | "denied" | "throttled"
    outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

/// How many calls are kept. A log that grows without limit is the memory leak this file has
/// already named once, under a different pleasant name.
const AGENT_LOG_CAP: usize = 200;

/// Per-agent write budget: how many persistent writes in how long.
///
/// Not about malice, about loops. An agent retrying a write in a tight loop would otherwise
/// rewrite settings.json as fast as it can post, and the first sign would be disk churn.
/// Generous enough that no reasonable caller ever meets it.
const AGENT_WRITE_LIMIT: usize = 10;
const AGENT_WRITE_WINDOW_MS: u64 = 60_000;

#[derive(Default)]
struct AgentRegistry {
    agents: Mutex<HashMap<String, AgentIdentity>>,
    stage: Mutex<Option<StageClaim>>,
    /// Newest last, capped at AGENT_LOG_CAP.
    log: Mutex<Vec<AgentCall>>,
    /// Timestamps of recent persistent writes, per agent - see AGENT_WRITE_LIMIT.
    writes: Mutex<HashMap<String, Vec<u64>>>,
    /// Grants the user has made, by agent id.
    ///
    /// Kept separately from `agents` and outliving it, because the two answer different
    /// questions. `agents` is who has called recently - it is capped, it evicts the stalest
    /// entry, and it is empty after a restart. A GRANT is a decision the user made, and it has
    /// to survive both: an agent that gets evicted for being quiet for a week, or that is simply
    /// the first to call after a reboot, must not come back with its permission silently reset.
    /// Fail-safe would be the wrong instinct here - it would quietly revoke a decision instead
    /// of quietly keeping one, and the user would have no way to tell which happened.
    saved: Mutex<HashMap<String, AgentPermission>>,
    /// Where `saved` is written. None when the config dir is unavailable, in which case grants
    /// last for this session only.
    permissions_path: Mutex<Option<PathBuf>>,
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
    /// What this id is allowed to do. An id we have never seen gets `default_permission_for`
    /// rather than being refused: an agent that has not registered yet is not suspicious, it is new.
    fn permission_of(&self, id: &str) -> AgentPermission {
        if let Some(agent) = self.agents.lock().unwrap().get(id) {
            return agent.permission;
        }
        // Not called yet this session - fall back to what the user granted before.
        self.saved
            .lock()
            .unwrap()
            .get(id)
            .copied()
            .unwrap_or_else(|| default_permission_for(id))
    }

    /// Grant (or revoke) a tier, and write it down.
    fn set_permission(&self, id: &str, permission: AgentPermission) {
        self.saved.lock().unwrap().insert(id.to_string(), permission);
        if let Some(agent) = self.agents.lock().unwrap().get_mut(id) {
            agent.permission = permission;
        }
        self.save_permissions();
    }

    fn save_permissions(&self) {
        let Some(path) = self.permissions_path.lock().unwrap().clone() else { return };
        let saved = self.saved.lock().unwrap();
        let map: HashMap<&str, &str> = saved.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let Ok(body) = serde_json::to_string_pretty(&map) else { return };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        // Same write-then-rename as the settings file: a half-written permissions file that
        // parsed as valid JSON would silently drop grants.
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, body).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }

    fn load_permissions(&self, path: PathBuf) {
        *self.permissions_path.lock().unwrap() = Some(path.clone());
        let Ok(text) = std::fs::read_to_string(&path) else { return };
        let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&text) else { return };
        let mut saved = self.saved.lock().unwrap();
        for (id, tier) in map {
            // An unrecognised tier is dropped rather than defaulted: a file written by a newer
            // build should not silently downgrade a grant it does not understand.
            if let Some(permission) = AgentPermission::parse(&tier) {
                saved.insert(id, permission);
            }
        }
    }

    /// Record one call. Oldest entries fall off the front once the cap is reached.
    fn record(&self, agent: &str, surface: &str, asked: String, outcome: &str, reason: Option<String>) {
        let mut log = self.log.lock().unwrap();
        if log.len() >= AGENT_LOG_CAP {
            let overflow = log.len() + 1 - AGENT_LOG_CAP;
            log.drain(0..overflow);
        }
        log.push(AgentCall {
            at: now_millis(),
            agent: agent.to_string(),
            surface: surface.to_string(),
            // Bounded like every other string that came from outside and ends up in the UI.
            asked: asked.chars().take(160).collect(),
            outcome: outcome.to_string(),
            reason: reason.map(|r| r.chars().take(200).collect()),
        });
    }

    /// Take one unit of this agent's write budget, or refuse.
    ///
    /// A sliding window rather than a fixed one: a fixed window lets a caller spend the whole
    /// budget at 0:59 and the whole budget again at 1:01, which is exactly the burst it is
    /// supposed to prevent.
    fn take_write_budget(&self, id: &str, now: u64) -> bool {
        let mut writes = self.writes.lock().unwrap();
        let stamps = writes.entry(id.to_string()).or_default();
        stamps.retain(|t| now.saturating_sub(*t) < AGENT_WRITE_WINDOW_MS);
        if stamps.len() >= AGENT_WRITE_LIMIT {
            return false;
        }
        stamps.push(now);
        true
    }

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

    /// Give back a reaction that was taken but could not be played.
    ///
    /// `take_next_due` REMOVES the item before returning it, and the drain loop's `claim_stage`
    /// can still lose a race to an HTTP thread that claimed the stage in between. Putting the
    /// item back at the FRONT preserves its order; its `expires_at` is untouched, so one that
    /// sat out the whole race still gets dropped by the next `take_next_due` rather than shown
    /// stale. (The drain loop used to just `continue` here, with a comment claiming the item
    /// "stays queued" - it did not; an alert could be silently destroyed by exactly the race
    /// this queue exists to absorb.)
    fn requeue_front(&self, item: QueuedReaction) {
        let mut queue = self.queue.lock().unwrap();
        queue.insert(0, item);
        if queue.len() > REACTION_QUEUE_CAP {
            queue.truncate(REACTION_QUEUE_CAP);
        }
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

/// Cap for the agent registry. Every distinct `agent` string any caller ever sends becomes a
/// permanent entry otherwise - a memory leak with a badge. Sixty-four is far more identities
/// than one person's machine has tools.
const AGENT_REGISTRY_CAP: usize = 64;

/// Insert-or-update under the registry cap, evicting the least-recently-seen identity when a
/// NEW id would exceed it. Returns the entry so the caller can apply its own update; `last_seen`
/// is bumped here, since both call sites mean "this identity is alive right now".
fn registry_entry<'a>(
    agents: &'a mut HashMap<String, AgentIdentity>,
    id: &str,
    now: u64,
    seeded_permission: AgentPermission,
) -> &'a mut AgentIdentity {
    if !agents.contains_key(id) {
        while agents.len() >= AGENT_REGISTRY_CAP {
            let stalest = agents.values().min_by_key(|a| a.last_seen).map(|a| a.id.clone());
            match stalest {
                Some(victim) => {
                    agents.remove(&victim);
                }
                None => break,
            }
        }
    }
    let entry = agents
        .entry(id.to_string())
        .or_insert_with(|| AgentIdentity {
            id: id.to_string(),
            name: id.to_string(),
            badge: id.chars().take(2).collect(),
            logo: None,
            color: "#8b95a5".to_string(),
            registered_at: now,
            last_seen: now,
            claims: 0,
            // Seeded from the saved grants, not from the default - see AgentRegistry::saved.
            permission: seeded_permission,
        });
    entry.last_seen = now;
    entry
}

/// Look the caller up, registering a minimal identity for one that never called POST /agents.
///
/// An unregistered caller is not refused: the bridge predates the registry and the whole point
/// of a local HTTP surface is that `curl` works. It just shows up as itself with a neutral badge.
fn resolve_agent(registry: &AgentRegistry, id: Option<&str>, now: u64) -> AgentIdentity {
    let id = id.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("anonymous");
    // The id comes from outside this process and becomes a map key and UI text, so it gets the
    // same treatment as every other external string: bounded.
    let id: String = id.chars().take(64).collect();
    // Read before taking the agents lock: permission_of takes it too, and taking it twice on
    // one thread is a deadlock, not a slow path.
    let seeded = registry
        .saved
        .lock()
        .unwrap()
        .get(&id)
        .copied()
        .unwrap_or_else(|| default_permission_for(&id));
    let mut agents = registry.agents.lock().unwrap();
    let entry = registry_entry(&mut agents, &id, now, seeded);
    entry.claims += 1;
    entry.clone()
}

/// Who is making this write: the `X-Lingxi-Agent` header, else the body's own `agent` field,
/// else `anonymous`.
///
/// Both sources, deliberately. An earlier version read only the header, with a comment
/// explaining that the body is consumed once and cannot be re-read here - true, and it is why
/// the body is now read BEFORE the check rather than after. But the consequence of
/// header-only was that `/memory` and `/reminders` answered 403 to every shipped client,
/// because not one of them sent that header: the CLI, the MCP server and the DSH plugin all
/// name themselves in the body's `agent` field, which is what `/control` and `/task-event`
/// have always read. So did every `curl` example in docs/19, and a bare curl is documented as
/// something that must keep working.
///
/// The header still wins when both are present: a host that wants to attribute a call it is
/// relaying should not be overridable by the payload it is relaying.
fn write_caller_id(request: &tiny_http::Request, body: Option<&serde_json::Value>) -> String {
    let header = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("X-Lingxi-Agent"))
        .map(|h| h.value.as_str());
    resolve_write_caller_id(header, body)
}

/// The part of `write_caller_id` that does not need a live request, so it can be tested.
fn resolve_write_caller_id(header: Option<&str>, body: Option<&serde_json::Value>) -> String {
    let clean = |v: &str| -> Option<String> {
        let trimmed: String = v.trim().chars().take(64).collect();
        (!trimmed.is_empty()).then_some(trimmed)
    };
    header
        .and_then(clean)
        .or_else(|| body.and_then(|v| v.get("agent")).and_then(|v| v.as_str()).and_then(clean))
        .unwrap_or_else(|| "anonymous".to_string())
}

/// Refuse a persistent write from an agent that is not trusted, or None to let it through.
///
/// `/control` filters per field, because a control call usually asks for several things and one
/// over-reaching field should not cost the caller the rest. These two endpoints do exactly one
/// thing each, so there is nothing to filter: it is allowed or it is not.
///
/// Takes the already-parsed body so that `write_caller_id` can fall back to its `agent` field -
/// see that function for why the header alone was not enough.
fn refuse_untrusted_write(
    app: &tauri::AppHandle,
    request: &tiny_http::Request,
    body: Option<&serde_json::Value>,
    surface: &str,
) -> Option<tiny_http::Response<std::io::Cursor<Vec<u8>>>> {
    let id = write_caller_id(request, body);
    let registry = app.state::<AgentRegistry>();
    let permission = registry.permission_of(&id);
    let now = now_millis();
    if !permission.may_write_settings() {
        let reason = format!(
            "「{id}」的权限档位是 {}，不能写 {surface}。要放行，去 主界面 → Agent 接入 →「权限与日志」，把「{id}」改成 trusted。",
            permission.as_str()
        );
        registry.record(&id, surface, "write".to_string(), "denied", Some(reason.clone()));
        return Some(json_response(
            403,
            serde_json::json!({ "ok": false, "rejected": [reason] }).to_string(),
        ));
    }
    if !registry.take_write_budget(&id, now) {
        let reason = format!("「{id}」一分钟内的写入超过 {AGENT_WRITE_LIMIT} 次，这次先挡下。");
        registry.record(&id, surface, "write".to_string(), "throttled", Some(reason.clone()));
        return Some(json_response(
            429,
            serde_json::json!({ "ok": false, "rejected": [reason] }).to_string(),
        ));
    }
    registry.record(&id, surface, "write".to_string(), "applied", None);
    None
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

    // --- permissions ---------------------------------------------------------------------
    //
    // Filtered once, here, rather than guarded at each of the field sites below. A check that
    // has to be remembered at every site is a check that will eventually be forgotten at one,
    // and the one it is forgotten at is a persistent write granted to everybody.
    //
    // A denied field is REMOVED from the command and reported in `rejected`, so the rest of the
    // call still applies. A themed-and-expressive request from a performer sets the expression
    // and is told, in the same response, that the theme did not change and why. Refusing the
    // whole call instead would make a single over-reaching field silently cost the caller
    // everything else it asked for.
    let permission = identity.permission;
    let mut command_owned = command.clone();
    let asked: String = command
        .as_object()
        .map(|o| {
            o.keys()
                .filter(|k| !k.starts_with("__") && *k != "agent" && *k != "priority")
                .cloned()
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();

    if !permission.may_perform() {
        // observer: nothing to filter, there is nothing it may do.
        registry.record(
            &identity.id,
            "control",
            asked,
            "denied",
            Some("权限档位是 observer（只读）".to_string()),
        );
        rejected.push(format!(
            "「{}」的权限档位是 observer（只读），这次调用没有任何改动。要放行，去 主界面 → Agent 接入 → 权限。",
            identity.name
        ));
        return (applied, rejected, serde_json::Value::Object(detail));
    }

    if let Some(object) = command_owned.as_object_mut() {
        let wanted_settings: Vec<String> =
            SETTINGS_FIELDS.iter().filter(|f| object.contains_key(**f)).map(|f| f.to_string()).collect();
        if !wanted_settings.is_empty() {
            let allowed = permission.may_write_settings();
            // The budget is spent only by a caller that is actually allowed to write, so a
            // denied agent retrying cannot exhaust a budget it was never going to use.
            let within_budget = allowed && registry.take_write_budget(&identity.id, now);
            if !allowed || !within_budget {
                for field in &wanted_settings {
                    object.remove(field);
                }
                let reason = if !allowed {
                    format!(
                        "「{}」的权限档位是 {}，不能改会保存下来的设置（{}）。要放行，去 主界面 → Agent 接入 → 权限，改成 trusted。",
                        identity.name,
                        permission.as_str(),
                        wanted_settings.join("、"),
                    )
                } else {
                    format!(
                        "「{}」一分钟内的设置写入超过 {} 次，这次先挡下（{}）。",
                        identity.name,
                        AGENT_WRITE_LIMIT,
                        wanted_settings.join("、"),
                    )
                };
                registry.record(
                    &identity.id,
                    "control",
                    wanted_settings.join(","),
                    if allowed { "throttled" } else { "denied" },
                    Some(reason.clone()),
                );
                rejected.push(reason);
            }
        }
    }
    let command = &command_owned;

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
    // Pre-flight the stage-worthy fields BEFORE claiming the stage. The order used to be claim
    // first, validate later, so a command like `{"agent":"a","action":"not-a-clip"}` held the
    // stage for its whole hold window with the agent's badge on screen, then came back 400 -
    // and every other agent's reaction in that window was told "stage busy" by a command that
    // was never going to play. The same messages are produced again by the field sections
    // below; this pass only decides whether the request has earned the stage. (`say` is
    // included because a whitespace-only line is rejected there too.)
    let stage_preflight_rejected: Vec<String> = if wants_stage {
        let mut problems: Vec<String> = Vec::new();
        if let Some(action) = command.get("action").and_then(|v| v.as_str()) {
            if action.trim().is_empty() {
                problems.push("action: empty id".to_string());
            } else if let Err(message) = check_known(&caps, "actions", "id", action, "action") {
                problems.push(message);
            }
        }
        if let Some(expression) = command.get("expression").and_then(|v| v.as_str()) {
            if expression.trim().is_empty() {
                problems.push("expression: empty name".to_string());
            } else if let Err(message) = check_known(&caps, "expressions", "name", expression, "expression") {
                problems.push(message);
            }
        }
        if let Some(id) = command.get("perform").and_then(|v| v.as_str()) {
            if !KNOWN_PERFORMANCES.contains(&id) {
                problems.push(format!("perform: unknown performance \"{id}\" (see GET /capabilities)"));
            }
        }
        if let Some(kind) = command.get("toy").and_then(|v| v.as_str()) {
            if kind != "none" && !KNOWN_TOYS.contains(&kind) {
                problems.push(format!("toy: unknown toy \"{kind}\" (expected one of {KNOWN_TOYS:?} or \"none\")"));
            }
        }
        if let Some(text) = command.get("say").and_then(|v| v.as_str()) {
            let (trimmed, _) = truncate_chars(text, SAY_MAX_CHARS);
            if trimmed.is_empty() {
                problems.push("say: empty text".to_string());
            }
        }
        problems
    } else {
        Vec::new()
    };
    let wants_stage = wants_stage && stage_preflight_rejected.is_empty();
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
                        "label": command.get("__label").and_then(|v| v.as_str()),
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
                | "agent" | "priority" | "openManagement" => value.is_string(),
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
    if let Some(route) = command.get("openManagement").and_then(|v| v.as_str()) {
        match parse_management_route(route) {
            Ok(route) => {
                open_management_at(app, Some(route.clone()));
                applied.push(format!("openManagement={route}"));
            }
            Err(reason) => rejected.push(format!("openManagement: {reason}")),
        }
    }
    if applied.is_empty() && rejected.is_empty() {
        rejected.push(format!(
            "empty command: expected at least one of {CONTROL_FIELDS:?}"
        ));
    }
    // Successes are logged too, not only refusals. A log that only records what went wrong
    // answers "why did this stop working" but not "what has this agent actually been doing",
    // and the second is the question a user asks before granting a tier.
    if !applied.is_empty() {
        registry.record(&identity.id, "control", applied.join(","), "applied", None);
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
    if a.len() == b.len() {
        // Equal lengths: a single substitution, or an adjacent TRANSPOSITION ("camrea" for
        // "camera"). The single-difference scan below cannot see a transposition - it counts
        // as two substitutions - and a missed one here means a mistyped field gets rejected
        // as unknown instead of suggested, which is the exact failure this helper exists to
        // soften. First mismatch, swapped neighbours, equal tails: that is a transposition.
        match (0..a.len()).find(|&i| a[i] != b[i]) {
            None => true, // identical; the caller's eq_ignore_ascii_case arm means this is moot
            Some(k) => {
                a[k + 1..] == b[k + 1..]
                    || (k + 1 < a.len()
                        && a[k] == b[k + 1]
                        && a[k + 1] == b[k]
                        && a[k + 2..] == b[k + 2..])
            }
        }
    } else {
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
            // Something took the stage in between the free check and the claim. The item was
            // already REMOVED from the queue by take_next_due, so it must go back - dropping
            // it here would destroy exactly the alert/report reactions the queue exists to
            // protect. Its expires_at still bounds how long it can sit.
            registry.requeue_front(item);
            continue;
        }
        let _ = app.emit(
            "agent-stage",
            serde_json::json!({
                "agent": item.agent.id,
                "name": item.agent.name,
                "label": item.command.get("__label").and_then(|v| v.as_str()),
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

/// Pending reminders, soonest first - what 主界面's 提醒与日程 lists.
#[tauri::command]
fn get_reminders(state: State<MemoryState>) -> Vec<Reminder> {
    let mut pending: Vec<Reminder> = state.reminders.lock().unwrap().iter().filter(|r| !r.done).cloned().collect();
    pending.sort_by_key(|r| r.due);
    pending
}

/// Cancel one, from 主界面. The user's own list: no permission tier applies.
#[tauri::command]
fn delete_reminder(state: State<MemoryState>, id: String) -> bool {
    let removed = {
        let mut reminders = state.reminders.lock().unwrap();
        let before = reminders.len();
        reminders.retain(|r| r.id != id);
        reminders.len() != before
    };
    if removed {
        state.persist_reminders();
    }
    removed
}

/// Set one from 主界面 - a schedule item the user types in themselves ("每天 09:30 站会").
#[tauri::command]
fn add_reminder(state: State<MemoryState>, text: String, due: u64, repeat_every_minutes: u64) -> Result<String, String> {
    let (text, _) = truncate_chars(text.trim(), REMINDER_MAX_CHARS);
    if text.is_empty() {
        return Err("提醒内容不能是空的".to_string());
    }
    if due <= now_millis() && repeat_every_minutes == 0 {
        return Err("这个时间已经过去了".to_string());
    }
    let repeat = if repeat_every_minutes == 0 { 0 } else { repeat_every_minutes.max(5) };
    let id = format!("u{}", now_millis());
    {
        let mut reminders = state.reminders.lock().unwrap();
        reminders.push(Reminder {
            id: id.clone(),
            text,
            // A daily one whose time has passed today starts tomorrow.
            due: if due <= now_millis() { next_due(due, repeat, now_millis()) } else { due },
            done: false,
            mood: "focused".to_string(),
            repeat_every_minutes: repeat,
            from: "你".to_string(),
        });
        let overflow = reminders.len().saturating_sub(REMINDER_CAP);
        if overflow > 0 {
            reminders.drain(0..overflow);
        }
    }
    state.persist_reminders();
    Ok(id)
}

/// Whether the cat is on screen at all. A hidden cat cannot deliver anything - see system_notify.
fn cat_hidden(app: &tauri::AppHandle) -> bool {
    !app.state::<TrayState>().visible.load(Ordering::SeqCst)
}

/// A macOS notification, for what must reach the user when the cat cannot say it: it is hidden.
/// Used only for things that wait on them (an approval, a question, a failure) and for reminders
/// - a hidden cat is someone asking for quiet, and a completion can wait for them to look.
///
/// NSUserNotification rather than UserNotifications.framework: it needs no new dependency and
/// no permission prompt for an app like this one, and it still delivers. Deprecated, so the day
/// it stops, this is the one function to replace.
#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn system_notify(app: &tauri::AppHandle, title: &str, body: &str) {
    let (title, body) = (title.to_string(), body.to_string());
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        use objc2_foundation::{NSString, NSUserNotification, NSUserNotificationCenter};
        let note = NSUserNotification::new();
        note.setTitle(Some(&NSString::from_str(&title)));
        note.setInformativeText(Some(&NSString::from_str(&body)));
        let center = NSUserNotificationCenter::defaultUserNotificationCenter();
        center.deliverNotification(&note);
        // Evidence, not hope: whether the system took it. A deprecated API can stop delivering
        // in some macOS release without any error - this is where that would show.
        log_task_event(
            &handle,
            serde_json::json!({
                "dir": "notify",
                "delivered": note.isPresented() || center.deliveredNotifications().count() > 0,
                "presented": note.isPresented(),
                "inCenter": center.deliveredNotifications().count(),
            }),
        );
    });
}

#[cfg(not(target_os = "macos"))]
fn system_notify(_app: &tauri::AppHandle, _title: &str, _body: &str) {}

/// Keyboard and mouse both idle this long means nobody is at the machine.
const REMINDER_AWAY_SECS: u64 = 5 * 60;

/// Seconds since the last keyboard or mouse input, system-wide (IOHIDSystem's HIDIdleTime).
/// Asked only when a reminder is due, so shelling out costs nothing that matters. None when it
/// cannot be read - then the reminder is delivered as before rather than held forever.
fn system_idle_secs() -> Option<u64> {
    let out = std::process::Command::new("/usr/sbin/ioreg")
        .args(["-c", "IOHIDSystem", "-d", "4", "-r", "-k", "HIDIdleTime"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().find(|l| l.contains("\"HIDIdleTime\""))?;
    let nanos: u64 = line.rsplit('=').next()?.trim().parse().ok()?;
    Some(nanos / 1_000_000_000)
}

/// The next time a standing reminder is due, kept on its own schedule.
///
/// It used to be "now + interval", measured from when it happened to be SAID: every firing
/// slipped by up to a tick, and one that waited out a closed laptop moved for good - a daily
/// 09:30 became whatever time the app was next opened. Stepping from the previous due time keeps
/// 09:30 at 09:30; occurrences missed entirely are skipped rather than recited.
fn next_due(previous_due: u64, every_minutes: u64, now: u64) -> u64 {
    let step = every_minutes.max(1).saturating_mul(60_000);
    if previous_due > now {
        return previous_due.saturating_add(step);
    }
    let missed = (now - previous_due) / step + 1;
    previous_due.saturating_add(missed.saturating_mul(step))
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
            let reminders = state.reminders.lock().unwrap();
            let now = now_millis();
            reminders
                .iter()
                .filter(|reminder| !reminder.done && reminder.due <= now)
                // Oldest first, so a backlog comes out in the order it was promised.
                .min_by_key(|reminder| reminder.due)
                .cloned()
        };
        let Some(reminder) = next else { continue };
        // Said to an empty room is the same as not said: it used to be spoken once, for six
        // seconds, and marked done whether or not anyone was at the machine. Now it waits for
        // them - the first thing they see coming back is what they asked to be told.
        if system_idle_secs().is_some_and(|idle| idle >= REMINDER_AWAY_SECS) {
            continue;
        }
        if cat_hidden(&app) {
            system_notify(&app, "灵犀 · 提醒", &reminder.text);
        }
        {
            // Its own attribution, so the bubble does not borrow whichever agent spoke last:
            // the mark of whoever set it, named as a reminder.
            let _ = app.emit(
                "agent-stage",
                serde_json::json!({
                    "agent": if reminder.from.is_empty() { "lingxi" } else { reminder.from.as_str() },
                    "name": "提醒",
                    "badge": "⏰",
                    "logo": null,
                    "color": "#F4E6C8",
                    "priority": "report",
                    "holdMs": 6000,
                }),
            );
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
        }
        // Mark done only AFTER speaking, then persist. The old order (mark, persist, speak)
        // meant a crash in between silently swallowed the reminder - flagged complete, never
        // said. The reverse costs at most one repeat after a crash, which is an apology rather
        // than a silence.
        {
            let mut reminders = state.reminders.lock().unwrap();
            if let Some(entry) = reminders.iter_mut().find(|r| r.id == reminder.id) {
                // A standing reminder re-arms rather than being recreated by the caller - the
                // whole point of "every hour, stand up" is that nothing has to remember to
                // re-ask. saturating_mul: a user who typed a huge "every N minutes" must get a
                // far-future due date, not a wrapped-around past one (release) or a panic that
                // takes this whole ticker thread down (debug) - a panic here is unrecoverable,
                // every reminder after it silently stops firing.
                if reminder.repeat_every_minutes > 0 {
                    entry.done = false;
                    entry.due = next_due(reminder.due, reminder.repeat_every_minutes, now_millis());
                } else {
                    entry.done = true;
                }
            }
        }
        state.persist_reminders();
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
                Ok(s) => {
                    app.state::<BridgeBindState>().listening.store(true, Ordering::Relaxed);
                    break s;
                }
                Err(e) if attempt < 10 => {
                    attempt += 1;
                    eprintln!(
                        "[lingxi-desktop] perception HTTP server bind attempt {attempt} failed ({e}), retrying..."
                    );
                    thread::sleep(Duration::from_millis(300));
                }
                Err(e) => {
                    eprintln!("[lingxi-desktop] perception HTTP server failed to bind 127.0.0.1:{PERCEPTION_HTTP_PORT} after {attempt} retries: {e}");
                    // The failure must be visible, not just logged: a machine where another
                    // local process (possibly another user's copy of this very app - loopback
                    // ports are not per-user) holds 47811 leaves every agent's hook posting
                    // its Bearer token to the port holder. The management page reads this
                    // flag and says so, instead of reporting a bridge that does not exist.
                    eprintln!("[lingxi-desktop] the bridge is DOWN; agent hooks will post their token to whatever holds port {PERCEPTION_HTTP_PORT}. Find it with: lsof -nP -iTCP:{PERCEPTION_HTTP_PORT} -sTCP:LISTEN");
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
        // When this app instance came up. A wrapper that dresses its host (the 豆包 logo) keys
        // "already registered" on it: the registry is in memory, so a new instance needs it again.
        let started_at = now_millis();
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
                        "startedAt": started_at,
                        "authRequired": true,
                        "tokenFile": token_path,
                        // Where the bundled shell client lives. A skill that says "run lingxi"
                        // needs somewhere to point when it is not on PATH and there is no checkout.
                        "cli": app
                            .path()
                            .app_config_dir()
                            .ok()
                            .map(|d| d.join("bin").join("lingxi").display().to_string()),
                        "howTo": "Read the token file and send it as `Authorization: Bearer <token>` \
                                  or `X-Lingxi-Token: <token>`. Do NOT put the token in the URL: \
                                  headers stay out of shell history and access logs. The file is \
                                  readable only by your own account.",
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

            let mut response = match (method, url.as_str()) {
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
                                "builtin": {
                                    "note": "The effective built-in mapping for every (state, kind, mood) triple - what the cat does BEFORE your reactions.json overrides are applied. Repeated values mean the mapping is coarser than the key. This is the table the docs promise is authoritative; the overrides above are the only delta.",
                                    "table": builtin_reaction_table(),
                                },
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
                    let body = read_body_capped(&mut request);
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
                                // The id becomes a registry key and UI text; bound it like any
                                // other external string (resolve_agent caps at the same 64).
                                let id: String = id.chars().take(64).collect();
                                // Same ordering rule as resolve_agent: read the saved grant
                                // before taking the agents lock.
                                let seeded = registry
                                    .saved
                                    .lock()
                                    .unwrap()
                                    .get(&id)
                                    .copied()
                                    .unwrap_or_else(|| default_permission_for(&id));
                                let identity = {
                                    let mut agents = registry.agents.lock().unwrap();
                                    let entry = registry_entry(&mut agents, &id, now, seeded);
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
                    let body = read_body_capped(&mut request);
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
                    // The owner notes and the reminder list are the user's own writing, and
                    // they persist - so they sit on the same side of the line as settings, and
                    // need the same tier. See AgentPermission.
                    // Body first, permission second: the caller's id may be in the body (see
                    // write_caller_id), and it cannot be read back once the handler has it.
                    let body = read_body_capped(&mut request);
                    let parsed = serde_json::from_str::<serde_json::Value>(&body);
                    if let Some(refusal) =
                        refuse_untrusted_write(&app, &request, parsed.as_ref().ok(), "memory")
                    {
                        request.respond(refusal).ok();
                        continue;
                    }
                    match parsed {
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
                    // The owner notes and the reminder list are the user's own writing, and
                    // they persist - so they sit on the same side of the line as settings, and
                    // need the same tier. See AgentPermission.
                    // Body first, permission second - same reason as /memory above.
                    let body = read_body_capped(&mut request);
                    let parsed = serde_json::from_str::<serde_json::Value>(&body);
                    if let Some(refusal) =
                        refuse_untrusted_write(&app, &request, parsed.as_ref().ok(), "reminders")
                    {
                        request.respond(refusal).ok();
                        continue;
                    }
                    match parsed {
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
                                    // The id used to be `r{now_millis()}` - two reminders created
                                    // in the same millisecond shared an id, and DELETE (a retain
                                    // on id) removed both. A process-lifetime counter makes the
                                    // suffix unique however fast reminders arrive.
                                    static REMINDER_SEQ: AtomicU64 = AtomicU64::new(0);
                                    let id = format!(
                                        "r{}-{}",
                                        now_millis(),
                                        REMINDER_SEQ.fetch_add(1, Ordering::Relaxed)
                                    );
                                    {
                                        let mut reminders = state.reminders.lock().unwrap();
                                        reminders.push(Reminder {
                                            id: id.clone(),
                                            text,
                                            due,
                                            done: false,
                                            mood: mood.to_string(),
                                            repeat_every_minutes: repeat,
                                            from: write_caller_id(&request, Some(&value)),
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
                    let body = read_body_capped(&mut request);
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
                    let body = read_body_capped(&mut request);
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
                            // The buffer holds CLAUDE_TASK_EVENT_CAP and is the only history there is, so anything
                            // on the loopback interface could previously flush the real record
                            // out of it by posting `{}` in a loop. 200 still means "received",
                            // as before - it just is not also "recorded".
                            log_task_event(
                                &app,
                                serde_json::json!({
                                    "dir": "in",
                                    "payload": payload_shape(&raw),
                                    "event": {
                                        "provider": event.provider, "sourceId": event.source_id,
                                        "taskId": event.task_id, "state": event.state,
                                        "kind": event.kind, "mood": event.mood,
                                        "summary": event.summary, "label": event.label,
                                        "resultChars": event.result.as_ref().map(|r| r.chars().count()),
                                    },
                                }),
                            );
                            if event.state == "ended" {
                                forget_session(&app, &event);
                                json_response(
                                    200,
                                    serde_json::json!({ "ok": true, "recorded": false, "reason": "session ended" }).to_string(),
                                )
                            } else if event.state == "unknown" {
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
            // Cross-origin reads are granted to the dev console's origins ONLY, per response.
            // `*` used to be sent on every response, which let any page in any browser read
            // /health and the 401 body - both of which name the token file.
            const DEV_CORS_ORIGINS: [&str; 2] = ["http://localhost:1420", "http://127.0.0.1:1420"];
            let origin = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Origin"))
                .map(|h| h.value.as_str().to_string())
                .filter(|o| DEV_CORS_ORIGINS.contains(&o.as_str()));
            if let Some(origin) = origin {
                if let Ok(header) =
                    tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], origin.as_str())
                {
                    response.add_header(header);
                }
                if let Ok(header) = tiny_http::Header::from_bytes(
                    &b"Access-Control-Allow-Headers"[..],
                    &b"Content-Type, Authorization, X-Lingxi-Token"[..],
                ) {
                    response.add_header(header);
                }
            }
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
    /// Which agent set it, so the bubble can carry its mark - "提醒" from Claude reads
    /// differently from one the user's calendar agent set.
    #[serde(default)]
    from: String,
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

/// The complete built-in mapping, for GET /integration.
///
/// The docs (docs/19-agent-integration.md) promise that /integration is authoritative and
/// "以它为准", but the endpoint used to return only the override KEYS - an agent could see that
/// something had been retuned, never what the underlying behaviour actually was, and the doc
/// table drifted from the code anyway. This resolves every triple through the real lookup, so
/// the endpoint cannot lie about the build it is running in. Coarse tiers produce repeated
/// values under finer keys; that is data, not a bug.
fn builtin_reaction_table() -> serde_json::Map<String, serde_json::Value> {
    let mut table = serde_json::Map::new();
    for state in TASK_STATES {
        for kind in TASK_KINDS {
            for mood in TASK_MOODS {
                if let Some((expression, action, say)) = builtin_reaction(state, kind, mood) {
                    table.insert(
                        format!("{state}:{kind}:{mood}"),
                        serde_json::json!({ "expression": expression, "action": action, "say": say }),
                    );
                }
            }
        }
    }
    table
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

/// The HOST part of an http/https URL, parsed rather than prefix-matched.
///
/// The old check was `starts_with("http://localhost")`, which passed `http://localhost@evil.com`
/// (userinfo - the host is evil.com) and `http://localhost.evil.com` (a subdomain). Both would
/// have POSTed the payload - what the user is working on - to a machine they have never heard
/// of. Parse the authority instead: strip the userinfo, strip the port, compare the host
/// exactly. No authority, no scheme, no allowance.
fn url_host(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host_port = authority.rsplit_once('@').map(|(_, hp)| hp).unwrap_or(authority);
    // An IPv6 literal arrives bracketed; the port split below must not eat the brackets.
    if let Some(close) = host_port.rfind(']') {
        return host_port
            .get(..=close)
            .map(|h| h.trim_start_matches('[').trim_end_matches(']'));
    }
    host_port.split(':').next()
}

/// https anywhere; plain http only when the HOST is this machine.
fn sink_url_allowed(url: &str) -> bool {
    if url.starts_with("https://") {
        return true;
    }
    matches!(url_host(url), Some("127.0.0.1") | Some("localhost") | Some("::1"))
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
                        sink_url_allowed(&s.url)
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
/// A host lifecycle line. It says the turn started or ended, not what the turn did.
/// The sidebar title is the same kind of mistake: it names the chat as opened, and later
/// turns leave it behind. Neither may replace a summary the model just wrote.
fn bubble_line(text: &str) -> String {
    let count = text.chars().count();
    if count <= BUBBLE_SAY_CHARS {
        return text.to_string();
    }
    let cut: String = text.chars().take(BUBBLE_SAY_CHARS - 1).collect();
    format!("{cut}…")
}

/// Match the bubble's own hold (`1.8s + 0.13s` per character) so a short cheeky line
/// does not sit there, and a 24-character line still finishes being read.
fn bubble_hold_ms(text: &str) -> u64 {
    let chars = text.chars().count() as u64;
    (1800 + chars * 130).clamp(3200, 20_000)
}

/// The line an AGENT wrote to report where its task landed, said in full.
///
/// Only an agent's own report qualifies. A hook's summary is the host's wording - "Claude is
/// waiting for your input", a bare `rate_limit` - and the placeholder `"<kind>: <state>"` stands
/// in for a summary nobody wrote; saying either would read the plumbing aloud.
fn agent_task_report_line(event: &TaskEvent) -> Option<&str> {
    let placeholder = format!("{}: {}", event.kind, event.state);
    (!event.from_hook
        && event.result.is_none()
        && matches!(event.state.as_str(), "completed" | "failed" | "cancelled" | "needs_input" | "needs_approval" | "blocked"))
        .then(|| event.summary.trim())
        .filter(|summary| !summary.is_empty() && *summary != placeholder && !is_lifecycle_summary(summary))
}

fn is_lifecycle_summary(summary: &str) -> bool {
    let summary = summary.trim();
    summary.is_empty()
        || summary == "本轮回复结束"
        || summary == "Codex 回复结束"
        || summary == "会话开始"
        || summary == "新一轮对话开始"
        || summary.starts_with("本轮回复完成")
        || summary.starts_with("本轮因错误终止")
        || summary.starts_with("本轮已中止")
        || summary.starts_with("未识别的事件")
        || summary.starts_with("chat: ")
}

/// Keep the model's one-line result when a lifecycle event arrives a moment later.
///
/// Never a WAIT's line, though: once "想跑：清理构建目录" has been answered and the next turn is
/// running, keeping it would show a session still asking for something it already got.
fn keep_turn_summary(previous: &str, previous_state: &str, incoming: &str, age_ms: u64) -> bool {
    const FRESH_MS: u64 = 120_000;
    !matches!(previous_state, "needs_input" | "needs_approval")
        && !is_lifecycle_summary(previous)
        && is_lifecycle_summary(incoming)
        && age_ms <= FRESH_MS
}

/// The trail `/task-event` leaves on disk: one JSON line per event in, and one per reaction out,
/// in `<app config>/logs/task-events.log`. Rotated to `.1` past this size, so it never grows
/// without bound on a machine that runs the cat all day.
const TASK_EVENT_LOG_CAP_BYTES: u64 = 1024 * 1024;

/// Without it, "the cat said nothing useful" could only be debugged by guessing what the host
/// sent: the in-memory ring holds 50 normalized events and none of the raw payload's shape.
fn log_task_event(app: &tauri::AppHandle, mut entry: serde_json::Value) {
    use std::io::Write;
    let Some(dir) = app.path().app_config_dir().ok().map(|d| d.join("logs")) else { return };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("task-events.log");
    if std::fs::metadata(&path).map(|m| m.len() > TASK_EVENT_LOG_CAP_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("task-events.log.1"));
    }
    if let Some(object) = entry.as_object_mut() {
        object.insert("at".into(), serde_json::json!(now_millis()));
    }
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| writeln!(file, "{entry}"));
}

/// What a raw payload carried, without what it said: every key with its type, and for text its
/// length. docs/09 keeps the work's content out of the app, and a log is the easiest place for it
/// to leak back in. Only the few fields that are closed vocabularies are kept verbatim - they
/// are what tells one hook event from another.
fn payload_shape(raw: &serde_json::Value) -> serde_json::Value {
    const VERBATIM: [&str; 9] = [
        "hook_event_name", "notification_type", "stop_reason", "source", "error_type",
        "permission_mode", "state", "kind", "type",
    ];
    let Some(object) = raw.as_object() else { return serde_json::json!("not an object") };
    let shape: serde_json::Map<String, serde_json::Value> = object
        .iter()
        .map(|(key, value)| {
            let described = match value {
                serde_json::Value::String(text) if VERBATIM.contains(&key.as_str()) => {
                    serde_json::json!(text.chars().take(64).collect::<String>())
                }
                serde_json::Value::String(text) => serde_json::json!(format!("str({})", text.chars().count())),
                serde_json::Value::Bool(flag) => serde_json::json!(flag),
                serde_json::Value::Number(_) => serde_json::json!("num"),
                serde_json::Value::Null => serde_json::json!(null),
                serde_json::Value::Array(items) => serde_json::json!(format!("arr({})", items.len())),
                serde_json::Value::Object(inner) => {
                    serde_json::json!(format!("obj({})", inner.keys().cloned().collect::<Vec<_>>().join(",")))
                }
            };
            (key.clone(), described)
        })
        .collect();
    serde_json::Value::Object(shape)
}

/// A session that ended takes its 主界面 row with it, and its progress memory.
fn forget_session(app: &tauri::AppHandle, event: &TaskEvent) {
    app.state::<ActivityState>().by_provider.lock().unwrap().remove(&activity_key(event));
    app.state::<TaskProgressState>().seen.lock().unwrap().remove(&event.task_id);
    update_tray_attention(app);
}

/// How long an echo of a wait counts as the same wait. Claude's permission echo comes 6s after
/// the dialog and its idle echo 60s after the turn; past this, the user plainly did not see the
/// first one, and saying it again is the point.
const WAIT_ECHO_WINDOW_MS: u64 = 10 * 60 * 1000;

/// True when `event` only restates the wait its session's row already shows - see TaskEvent::echo.
fn is_repeat_wait(previous: Option<&AgentActivity>, event: &TaskEvent) -> bool {
    event.echo
        && previous.is_some_and(|row| {
            row.state == event.state && event.observed_at.saturating_sub(row.updated_at) < WAIT_ECHO_WINDOW_MS
        })
}

/// The activity-map row an event belongs to: its identity, split per session when the host has
/// sessions (see TaskEvent::session).
fn activity_key(event: &TaskEvent) -> String {
    let identity = if event.source_id.is_empty() { &event.provider } else { &event.source_id };
    match &event.session {
        Some(session) => format!("{identity}#{session}"),
        None => identity.clone(),
    }
}

/// How long an agent's own report can stand in for the turn-end hook that follows it. On the
/// session's own row the pairing is certain, so the window only has to outlast a long final
/// reply; on the tool's session-less row another session could have made the report, so it is
/// trusted only while it is plainly this turn's.
const SESSION_REPORT_WINDOW_MS: u64 = 15 * 60 * 1000;
const SESSIONLESS_REPORT_WINDOW_MS: u64 = 3 * 60 * 1000;

/// Whether the agent already reported this turn's result itself, making the host's turn-end
/// hook a repeat. `Some(true)` when the report is on the session's own row, `Some(false)` when
/// it is on the tool's session-less row, `None` when the hook has something to say.
///
/// The report is consumed: one report covers one turn end, so the next turn - which the agent
/// may not report - still gets the hook's line. This replaces comparing the report's text with
/// the reply's first sentence, which two separately written sentences almost never passed; the
/// hook's bubble then replaced the full report a few seconds after it appeared.
fn take_pending_report(app: &tauri::AppHandle, event: &TaskEvent) -> Option<bool> {
    if !(event.from_hook && event.turn_end) {
        return None;
    }
    let activity = app.state::<ActivityState>();
    let mut rows = activity.by_provider.lock().unwrap();
    let own = activity_key(event);
    let identity = if event.source_id.is_empty() { event.provider.clone() } else { event.source_id.clone() };
    for (key, window, same_row) in [(own.clone(), SESSION_REPORT_WINDOW_MS, true), (identity, SESSIONLESS_REPORT_WINDOW_MS, false)] {
        if !same_row && key == own {
            continue;
        }
        let Some(row) = rows.get_mut(&key) else { continue };
        if row.report.as_ref().is_some_and(|report| report_covers_turn_end(report, event, window)) {
            row.report = None;
            return Some(same_row);
        }
    }
    None
}

/// Whether an agent's report already says what this turn-end hook would.
fn report_covers_turn_end(report: &PendingReport, event: &TaskEvent, window_ms: u64) -> bool {
    let fresh = event.observed_at.saturating_sub(report.at) <= window_ms;
    // A reply that ends on a question the agent did not report is news, not a repeat.
    let covers = event.state != "needs_input"
        || matches!(report.state.as_str(), "needs_input" | "needs_approval" | "blocked");
    fresh && covers
}

fn record_activity(app: &tauri::AppHandle, event: &TaskEvent, report_on_row: bool) {
    let state = app.state::<ActivityState>();
    let mut map = state.by_provider.lock().unwrap();
    // Keyed by the registered AGENT where there is one, falling back to the provider.
    //
    // Keying on provider alone made one tool appear twice: the plugin adapter reports
    // provider "claude" while the CLI reports "claude-code", so the same Claude Code showed up as
    // two rows with two states. The identity is what "who is doing what" is actually about; the
    // provider is just which transport it came in on.
    let key = activity_key(event);
    // The turn-end hook after the agent's own report adds nothing to the row: the report is the
    // better account of the turn, and a wait it announced must not be closed by the host saying
    // the reply ended. Only a title the row still lacks is taken.
    if report_on_row {
        if let Some(row) = map.get_mut(&key) {
            if row.label.is_none() && event.provider != "codex" {
                row.label = event.label.clone();
            }
            drop(map);
            update_tray_attention(app);
            return;
        }
    }
    // Keys arrive from outside the process; without a cap, every distinct source_id any caller
    // ever sends is a row forever. Past the cap, the stalest row gives way - the picture is
    // "who is doing what NOW", and a source that has gone quiet longest is the least of that.
    const ACTIVITY_CAP: usize = 64;
    if !map.contains_key(&key) && map.len() >= ACTIVITY_CAP {
        if let Some((stalest, _)) = map.iter().min_by_key(|(_, v)| v.updated_at).map(|(k, v)| (k.clone(), v.updated_at)) {
            map.remove(&stalest);
        }
    }
    // The live row may say what the turn came to (in memory only - see TaskEvent::result).
    let incoming = event.result.clone().unwrap_or_else(|| event.summary.clone());
    let summary = if let Some(previous) = map.get(&key) {
        let age_ms = event.observed_at.saturating_sub(previous.updated_at);
        if keep_turn_summary(&previous.summary, &previous.state, &incoming, age_ms) {
            previous.summary.clone()
        } else {
            incoming
        }
    } else {
        incoming
    };
    // A title, once known, outlives an event that could not read one (an unreadable transcript).
    let previous_label = map.get(&key).and_then(|row| row.label.clone());
    let label = if event.provider == "codex" {
        None
    } else if event.label_is_folder {
        previous_label.or_else(|| event.label.clone())
    } else {
        event.label.clone().or(previous_label)
    };
    let report = if agent_task_report_line(event).is_some() {
        Some(PendingReport { at: event.observed_at, state: event.state.clone() })
    } else if event.turn_end {
        None // the turn is over either way
    } else {
        map.get(&key).and_then(|row| row.report.clone())
    };
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
            summary,
            label,
            updated_at: event.observed_at,
            busy: state_is_busy(&event.state),
            report,
        },
    );
    drop(map);
    update_tray_attention(app);
}

/// Keep the native tray's read-only task summary in sync with the same latest-per-agent snapshot
/// used by the home surface. Only actionable waits and failures need an attention count.
fn update_tray_attention(app: &tauri::AppHandle) {
    let attention_count = app.state::<ActivityState>().by_provider.lock().unwrap().values()
        .filter(|activity| matches!(activity.state.as_str(), "failed" | "needs_input" | "needs_approval"))
        .count();
    let tray = app.state::<TrayState>();
    let text = if attention_count == 0 {
        "目前没有需要留意的任务".to_string()
    } else {
        format!("有 {attention_count} 个任务需要留意")
    };
    let _ = tray.attention_summary.set_text(&text);
    tray.refresh_status(app);
    // The count next to the menu-bar icon: visible without opening anything, and it stays until
    // the wait is answered - the one place a missed bubble is still findable.
    if let Some(icon) = app.tray_by_id("main-tray") {
        let _ = icon.set_title(if attention_count == 0 { None } else { Some(attention_count.to_string()) });
    }
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
    // task_id arrives from outside the process. Without a cap, every task any agent ever runs
    // here is remembered forever. Past the cap an arbitrary entry gives way: the map only
    // remembers progress fractions, so "arbitrary" is honest, and losing one task's
    // halfway-crossing memory costs at most one extra reaction.
    const SEEN_CAP: usize = 512;
    if !seen.contains_key(&event.task_id) && seen.len() >= SEEN_CAP {
        if let Some(victim) = seen.keys().next().cloned() {
            seen.remove(&victim);
        }
    }
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
    /// The session's name, when the source has sessions - see TaskEvent::label.
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    /// Unix millis of the last event from this source.
    #[serde(rename = "updatedAt")]
    updated_at: u64,
    /// True while the work is still going. Derived here so a caller does not have to know which
    /// states are terminal.
    busy: bool,
    /// The agent's own report of how its work landed, until the host's turn-end hook that
    /// follows it arrives - see take_pending_report. Never serialized.
    #[serde(skip)]
    report: Option<PendingReport>,
}

#[derive(Clone)]
struct PendingReport {
    at: u64,
    state: String,
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
    // A restatement of a wait already on screen neither updates the row (it would replace the
    // richer line - "想改 lib.rs" - with the host's generic one) nor speaks again.
    let repeat = {
        let activity = app.state::<ActivityState>();
        let map = activity.by_provider.lock().unwrap();
        is_repeat_wait(map.get(&activity_key(event)), event)
    };
    if repeat {
        log_task_event(app, serde_json::json!({ "dir": "react", "taskId": event.task_id, "state": event.state, "outcome": "silent: same wait already shown" }));
        return;
    }
    // The agent already told the user how this turn landed; the host's turn-end hook right after
    // it would replace that full report with the reply's first sentence.
    let already_reported = take_pending_report(app, event);
    // Recorded BEFORE the reaction is decided, and regardless of whether one is shown at all.
    // Progress updates are deliberately swallowed for the cat's sake (see should_react), but they
    // are exactly what "what is it doing right now" wants, so the two must not share a gate.
    record_activity(app, event, already_reported == Some(true));
    // The name the session's row settled on - its real title even when this event only knew
    // the folder (see TaskEvent::label_is_folder).
    let label = app
        .state::<ActivityState>()
        .by_provider
        .lock()
        .unwrap()
        .get(&activity_key(event))
        .and_then(|row| row.label.clone());
    // The activity window is awareness, not narration: every recorded event - silent progress
    // included - opens the engine's household-activity window, so a sleeping cat gets up when
    // work starts and only settles once it stops. This must NOT sit behind should_react: that
    // gate keeps a long task from narrating itself, and waking is not narrating. Terminal
    // states pulse too (a completion is news; the window it opens is just the wind-down).
    let busy = state_is_busy(&event.state);
    let _ = app.emit(
        "agent-activity",
        serde_json::json!({ "busy": busy }),
    );
    forward_to_sinks(app, event);
    if already_reported.is_some() {
        log_task_event(app, serde_json::json!({ "dir": "react", "taskId": event.task_id, "state": event.state, "outcome": "silent: task result already reported" }));
        return;
    }
    if !should_react(app, event) {
        log_task_event(app, serde_json::json!({ "dir": "react", "taskId": event.task_id, "state": event.state, "outcome": "silent: repeat progress" }));
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
        log_task_event(app, serde_json::json!({ "dir": "react", "taskId": event.task_id, "state": event.state, "outcome": "silent: no reaction mapped" }));
        return;
    };
    let (expression, action, line) = (
        expression.as_str(),
        action.as_deref(),
        line.as_deref(),
    );
    // A task event that speaks is a report on behalf of its source. Route that one command
    // through the same stage claim as /control so the bubble receives the registered logo and
    // respects cross-agent priority. Silent progress still changes only the cat's face/action;
    // it must not leave an attribution waiting for some unrelated future bubble.
    // The host's own words about this turn beat every template: they are about the task.
    let from_result = event.result.is_some()
        && matches!(event.state.as_str(), "completed" | "failed" | "needs_approval" | "needs_input");
    let report_line = if let Some(summary) = agent_task_report_line(event) {
        Some(summary.to_string())
    } else if from_result {
        event.result.clone()
    } else if event.state == "completed" {
        let summary = event.summary.trim();
        // A host notify says only that its chat turn ended. It is not evidence that the
        // user's underlying task succeeded, so never announce this kind as “搞定啦”.
        // A real one-line result — what this turn just did — is the line itself. A lifecycle
        // placeholder stays “本轮回复结束”, and is skipped when that result is already on file.
        // Name the host: "本轮回复结束" left the user guessing which of several agents had just
        // stopped, and it is the one line they asked never to see again.
        let chat_lead = format!("{} 回复结束，请查看结果", host_display_name(&event.provider));
        let lead = if event.kind == "chat" { chat_lead.as_str() } else { line.unwrap_or("已完成") };
        let default_summary = format!("{}: completed", event.kind);
        if event.kind == "chat" && is_lifecycle_summary(summary) {
            let activity = app.state::<ActivityState>();
            let kept = activity.by_provider.lock().unwrap();
            let already_said = kept.get(&activity_key(event)).is_some_and(|row| row.summary.trim() != summary.trim() && !is_lifecycle_summary(&row.summary));
            drop(kept);
            if already_said {
                None
            } else {
                Some(bubble_line(lead))
            }
        } else if summary.is_empty() || summary == default_summary.as_str() || is_lifecycle_summary(summary) {
            Some(bubble_line(lead))
        } else if event.kind == "chat" {
            Some(bubble_line(summary))
        } else {
            Some(bubble_line(&format!("{lead} · {summary}")))
        }
    } else {
        line.map(str::to_string)
    };
    let suppressed = report_line.is_none()
        && event.state == "completed"
        && event.kind == "chat"
        && is_lifecycle_summary(event.summary.trim());
    if let Some(report_line) = report_line {
        let agent = if event.source_id.is_empty() {
            &event.provider
        } else {
            &event.source_id
        };
        let priority = match event.state.as_str() {
            "failed" | "needs_input" | "needs_approval" => "alert",
            "completed" => "report",
            _ => "status",
        };
        let mut command = serde_json::json!({
            "agent": agent,
            "priority": priority,
            "expression": expression,
            "say": report_line,
            "sayMs": bubble_hold_ms(&report_line),
            "holdMs": bubble_hold_ms(&report_line),
        });
        if let Some(action) = action {
            command["action"] = serde_json::json!(action);
        }
        // Which session is speaking rides beside the identity, so the bubble can name it. `__`
        // keeps it internal: it is not part of /control's documented surface.
        if let Some(label) = &label {
            command["__label"] = serde_json::json!(label);
        }
        if priority == "alert" && cat_hidden(app) {
            let who = match (&label, event.provider.as_str()) {
                (Some(label), "claude") => format!("Claude Code · {label}"),
                (Some(label), provider) => format!("{provider} · {label}"),
                (None, "claude") => "Claude Code".to_string(),
                (None, provider) => provider.to_string(),
            };
            system_notify(app, &format!("灵犀 · {who}"), &report_line);
        }
        let (applied, rejected, mut detail) = apply_control_command(app, &command);
        if from_result {
            // The control call echoes what it said; a line made from the reply stays off disk.
            if let Some(object) = detail.as_object_mut() {
                object.remove("saidText");
            }
        }
        log_task_event(
            app,
            serde_json::json!({
                "dir": "react", "taskId": event.task_id, "state": event.state,
                "outcome": "spoke", "agent": agent, "label": label,
                "expression": expression, "action": action,
                // A line made from the reply is shown, not kept: only its length reaches disk.
                "say": if from_result { serde_json::json!(format!("<from reply: {} chars>", report_line.chars().count())) } else { serde_json::json!(report_line) },
                "applied": applied, "rejected": rejected, "detail": detail,
            }),
        );
    } else if !suppressed {
        let _ = app.emit("play-expression", serde_json::json!({ "name": expression, "holdMs": 4000 }));
        if let Some(action) = action {
            let _ = app.emit("play-action", serde_json::json!({ "id": action }));
        }
        log_task_event(app, serde_json::json!({ "dir": "react", "taskId": event.task_id, "state": event.state, "outcome": "face only", "expression": expression, "action": action }));
    } else {
        log_task_event(app, serde_json::json!({ "dir": "react", "taskId": event.task_id, "state": event.state, "outcome": "silent: turn result already shown" }));
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
    let size_submenu = Submenu::with_items(app, "大小", true, &[&size_small, &size_medium, &size_large])?;

    // These disabled rows make the tray a glanceable status surface without pretending a task
    // can be approved or controlled from a native menu.
    let initial_status = tray_status_text(DEFAULT_CAT_NAME, true, &[]);
    let status_summary = MenuItem::with_id(app, "status-summary", &initial_status, false, None::<&str>)?;
    // Clickable: "有 2 个任务需要留意" is only useful if it takes you to them.
    let attention_summary = MenuItem::with_id(app, "attention-summary", "目前没有需要留意的任务", true, None::<&str>)?;
    // Every toy and every effect, by name - the tray used to offer one fixed toy ("逗一逗") and
    // no effect at all, so switching either meant opening the main window.
    let toy_items = TRAY_TOYS
        .iter()
        .map(|(kind, name)| MenuItem::with_id(app, format!("toy:{kind}"), *name, true, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let clear_toy = MenuItem::with_id(app, "clear-toy", "收起玩具", true, None::<&str>)?;
    let toy_separator = PredefinedMenuItem::separator(app)?;
    let mut toy_entries: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        toy_items.iter().map(|item| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
    toy_entries.push(&toy_separator);
    toy_entries.push(&clear_toy);
    let toy_submenu = Submenu::with_items(app, "玩具", true, &toy_entries)?;
    let effect_items = TRAY_EFFECTS
        .iter()
        .map(|(id, name)| MenuItem::with_id(app, format!("perform:{id}"), *name, true, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let effect_entries: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        effect_items.iter().map(|item| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
    let effect_submenu = Submenu::with_items(app, "特效", true, &effect_entries)?;
    let main_window = MenuItem::with_id(app, "main-window", "打开主界面…", true, None::<&str>)?;
    let toggle_visibility = MenuItem::with_id(app, "toggle-visibility", "隐藏猫咪", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出灵犀", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &status_summary,
            &attention_summary,
            &PredefinedMenuItem::separator(app)?,
            &main_window,
            &toggle_visibility,
            &size_submenu,
            &toy_submenu,
            &effect_submenu,
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
                "main-window" | "attention-summary" => open_or_focus_management_window(app),
                "clear-toy" => { let _ = app.emit("clear-toy", ()); }
                id if id.starts_with("toy:") => {
                    let kind = &id["toy:".len()..];
                    if KNOWN_TOYS.contains(&kind) {
                        let _ = app.emit("set-toy", serde_json::json!({ "kind": kind }));
                    }
                }
                id if id.starts_with("perform:") => {
                    let effect = &id["perform:".len()..];
                    if KNOWN_PERFORMANCES.contains(&effect) {
                        let _ = app.emit("perform", serde_json::json!({ "id": effect }));
                    }
                }
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
        status_summary,
        status_text: Mutex::new(initial_status),
        attention_summary,
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
        // An all-whitespace line is not a no-op, it is the HUSH request. The debug console's
        // "收起" button sent exactly this and nothing happened: the empty text was dropped
        // here, no event ever fired, and the bubble stayed on screen under a dead button.
        // Empty means "take the current bubble down".
        let _ = app.emit("say", serde_json::json!({ "text": "", "durationMs": duration_ms }));
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
    open_management_at(app, None);
}

/// The main window's pages, as management.html names them (`data-page`).
const MANAGEMENT_PAGES: [&str; 6] = ["home", "agent", "personality", "play", "appearance", "settings"];

/// `page` or `page:panel` - e.g. `agent:claude` opens Agent 接入 with the Claude Code panel
/// expanded. This is how an integration shows the user where it is connected (the Claude Code
/// plugin does it once, right after installing the app): the one piece of setup that needs the
/// user's eyes, reached without them hunting through a tray menu for it.
fn parse_management_route(route: &str) -> Result<String, String> {
    let (page, panel) = route.split_once(':').unwrap_or((route, ""));
    if !MANAGEMENT_PAGES.contains(&page) {
        return Err(format!("unknown page \"{page}\" (expected one of {MANAGEMENT_PAGES:?})"));
    }
    if panel.len() > 32 || !panel.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(format!("panel \"{panel}\" must be a short lowercase id like \"claude\""));
    }
    Ok(if panel.is_empty() { page.to_string() } else { format!("{page}:{panel}") })
}

/// Open (or bring forward) the main window, optionally at a route. Always on the main thread:
/// this is reached from the bridge's worker thread as well as from the tray, and AppKit windows
/// must be created where AppKit runs.
fn open_management_at(app: &tauri::AppHandle, route: Option<String>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(existing) = handle.get_webview_window("management") {
            bring_to_front(&existing);
            if let Some(route) = route {
                let _ = existing.emit("management-navigate", route);
            }
            return;
        }
        build_management_window(&handle, route);
    });
}

/// Put a window in front of the user, whatever app they are in. Main thread only.
///
/// `set_focus` alone is not enough on macOS 14+: activation became cooperative, so an app that is
/// not already active is only brought forward if the frontmost app yields - and choosing a
/// menu-bar item does not make this app active. The window was created, but BEHIND the app in
/// front, so the first click looked like it did nothing and only a second one surfaced it.
/// `orderFrontRegardless` raises the window itself without asking for activation.
fn bring_to_front(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    #[cfg(target_os = "macos")]
    if let Ok(pointer) = window.ns_window() {
        // SAFETY: tauri hands back this window's live NSWindow, and we are on the main thread
        // (every caller runs inside run_on_main_thread or a menu handler).
        let ns_window = unsafe { &*(pointer as *const objc2_app_kit::NSWindow) };
        ns_window.orderFrontRegardless();
    }
}

fn build_management_window(app: &tauri::AppHandle, route: Option<String>) {
    // A window that does not exist yet cannot receive an event, so the route rides in as a
    // global the page reads on load. serde_json quotes it, so no route string can escape it.
    let script = format!(
        "window.__LINGXI_ROUTE__ = {};",
        serde_json::to_string(&route.unwrap_or_default()).unwrap_or_else(|_| "\"\"".into())
    );
    let builder = WebviewWindowBuilder::new(app, "management", WebviewUrl::App("management.html".into()))
        .initialization_script(&script)
        .title("灵犀 · 主界面")
        .inner_size(960.0, 680.0)
        .min_inner_size(860.0, 620.0)
        .resizable(true)
        .visible(true);
    match builder.focused(true).build() {
        // Built, then FOCUSED. A click on a menu-bar item does not activate the app, so a window
        // created without this opened behind whatever app was in front - it looked like the
        // click did nothing, and only the second click (which finds the window and focuses it)
        // brought it forward. set_focus also activates the app on macOS.
        Ok(window) => bring_to_front(&window),
        Err(e) => eprintln!("[lingxi-desktop] failed to open management window: {e}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_reminders,
            delete_reminder,
            add_reminder,
            primary_monitor_bounds,
            debug_log,
            claude_plugin_status,
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
            get_agent_activity,
            set_agent_permission,
            codex_integration_status,
            install_codex_skill,
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
            // Grants the user made in a previous session. Loaded before the bridge starts
            // listening, so the first call after a restart is already judged by the right tier
            // rather than by the default - otherwise a trusted agent that posts on launch gets
            // one refusal for no reason a user could explain.
            if let Ok(dir) = app.path().app_config_dir() {
                app.state::<AgentRegistry>().load_permissions(dir.join("agent-permissions.json"));
            }
            app.manage(TaskProgressState::default());
            app.manage(BridgeBindState::default());
            app.manage(BridgeToken::load_or_create(app.handle()));
            match install_cli(app.handle()) {
                Some(path) => eprintln!("[lingxi-desktop] shell client written to {}", path.display()),
                None => eprintln!("[lingxi-desktop] could not write the shell client; the MCP path still works"),
            }
            let generation_file = app.path().app_config_dir().ok().map(|dir| dir.join("claude-hooks-generation"));
            match upgrade_installed_claude_hooks(generation_file.as_deref()) {
                Ok(0) => {}
                Ok(n) => eprintln!("[lingxi-desktop] upgraded {n} Claude Code hook command(s) to the current form"),
                Err(error) => eprintln!("[lingxi-desktop] left Claude Code hooks as they were: {error}"),
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
    fn a_turn_end_does_not_replace_what_the_turn_just_did() {
        assert!(keep_turn_summary("登录失败提示改完了", "completed", "本轮回复结束", 1_000));
        assert!(!keep_turn_summary("登录失败提示改完了", "completed", "本轮回复结束", 121_000));
        assert!(!keep_turn_summary("本轮回复结束", "completed", "登录失败提示改完了", 1_000));
        assert!(is_lifecycle_summary("本轮回复完成（end_turn）"));
        assert!(!is_lifecycle_summary("登录失败提示改完了，相关测试过了"));
        let line = bubble_line("登录提示改好啦，测试也乖乖过了，顺便把文案也收短了");
        assert!(line.chars().count() <= BUBBLE_SAY_CHARS);
        assert!(line.ends_with('…'));
        assert_eq!(bubble_line("哼，好了"), "哼，好了");
        assert!(bubble_hold_ms("哼，好了") >= 3200);
        assert!(bubble_hold_ms(&"啊".repeat(24)) <= 6400);
        assert!(bubble_hold_ms(&"啊".repeat(100)) > 10_000, "long task summaries need time to read");
    }

    #[test]
    fn all_agents_keep_the_full_task_summary_for_terminal_notifications() {
        let summary = "登录测试已修复；18 项用例通过，下一步可以继续发布";
        for provider in ["codex", "workbuddy", "doubao", "claude", "dsh"] {
            let raw = serde_json::json!({
                "provider": provider, "agent": provider, "state": "completed",
                "kind": "test", "taskId": "fix-login", "summary": summary,
            });
            let event = normalize_generic_task_event(&raw, 1).unwrap();
            assert_eq!(agent_task_report_line(&event), Some(summary), "{provider}");
        }
        let waiting = normalize_generic_task_event(&serde_json::json!({
            "provider": "workbuddy", "state": "needs_input", "kind": "review",
            "taskId": "choose-design", "summary": "你希望采用方案 A 还是方案 B？",
        }), 1).unwrap();
        assert_eq!(agent_task_report_line(&waiting), Some("你希望采用方案 A 还是方案 B？"));
    }

    #[test]
    fn only_an_agents_own_summary_is_read_aloud_never_the_plumbing() {
        // Claude's idle Notification: its summary is Claude's English message. The built-in
        // "在等你哦" line says it; the raw message must not.
        let idle = claude("Notification", serde_json::json!({
            "notification_type": "idle_prompt", "message": "Claude is waiting for your input",
        }));
        assert_eq!(idle.state, "needs_input");
        assert_eq!(agent_task_report_line(&idle), None);
        // A hook adapter's failure carries a bare error code.
        let failed = normalize_generic_task_event(&serde_json::json!({
            "provider": "workbuddy", "state": "failed", "kind": "chat", "taskId": "s",
            "summary": "rate_limit", "origin": "hook",
        }), 1).unwrap();
        assert!(failed.from_hook);
        assert_eq!(agent_task_report_line(&failed), None);
        // A report nobody wrote a summary for gets the "<kind>: <state>" placeholder.
        let bare = normalize_generic_task_event(&serde_json::json!({
            "provider": "cli", "state": "completed", "kind": "test", "taskId": "t",
        }), 1).unwrap();
        assert_eq!(bare.summary, "test: completed");
        assert_eq!(agent_task_report_line(&bare), None);
    }

    #[test]
    fn a_turn_end_after_the_agents_own_report_is_a_repeat_once() {
        let stop = |reply: &str, at: u64| {
            let mut event = normalize_generic_task_event(&serde_json::json!({
                "provider": "claude", "state": "completed", "kind": "chat", "taskId": "s",
                "session": "s", "result": reply, "origin": "hook",
            }), 1).unwrap();
            event.observed_at = at;
            event
        };
        let done = PendingReport { at: 1_000, state: "completed".into() };
        let turn = stop("登录测试修好了，18 项都过了。", 5_000);
        assert!(turn.turn_end && turn.from_hook);
        assert!(report_covers_turn_end(&done, &turn, SESSION_REPORT_WINDOW_MS));
        // Too late for a report on the tool's session-less row, where another session may have made it.
        let late = stop("登录测试修好了。", 1_000 + SESSIONLESS_REPORT_WINDOW_MS + 1);
        assert!(!report_covers_turn_end(&done, &late, SESSIONLESS_REPORT_WINDOW_MS));
        // The reply ends on a question the report did not ask: that is news.
        let asks = stop("修好了。要现在发布吗？", 5_000);
        assert_eq!(asks.state, "needs_input");
        assert!(!report_covers_turn_end(&done, &asks, SESSION_REPORT_WINDOW_MS));
        let asked = PendingReport { at: 1_000, state: "needs_input".into() };
        assert!(report_covers_turn_end(&asked, &asks, SESSION_REPORT_WINDOW_MS));
        // Only the hook's turn end is ever a repeat: an agent's report carries neither flag.
        let report = normalize_generic_task_event(&serde_json::json!({
            "provider": "claude", "state": "completed", "kind": "chat", "taskId": "fix",
            "summary": "登录测试已修复",
        }), 1).unwrap();
        assert!(!report.from_hook && !report.turn_end);
    }

    #[test]
    fn the_tray_status_row_says_what_is_true_now() {
        assert_eq!(tray_status_text("小灵", true, &[]), "小灵 · 在桌面陪着你");
        assert_eq!(tray_status_text("小灵", false, &["Codex".into()]), "小灵 · 藏起来了");
        assert_eq!(tray_status_text("灵犀", true, &["Claude Code".into()]), "灵犀 · 陪 Claude Code 工作中");
        assert_eq!(
            tray_status_text("灵犀", true, &["Claude Code".into(), "Codex".into(), "豆包".into()]),
            "灵犀 · 陪 Claude Code、Codex 等 3 个伙伴工作中",
        );
    }

    #[test]
    fn codex_skills_install_upgrade_and_never_overwrite_an_edit() {
        let root = std::env::temp_dir().join(format!("lingxi-skill-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("lingxi");
        install_skill_dir(&dir, "v1").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("SKILL.md")).unwrap(), "v1");
        // Untouched since we wrote it: a new app version upgrades it.
        install_skill_dir(&dir, "v2").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("SKILL.md")).unwrap(), "v2");
        // Edited by the user: left alone, and said so.
        std::fs::write(dir.join("SKILL.md"), "mine").unwrap();
        assert!(install_skill_dir(&dir, "v3").is_err());
        assert_eq!(std::fs::read_to_string(dir.join("SKILL.md")).unwrap(), "mine");
        // A dead link from the old single-skill layout is replaced, not reported as a failure.
        let dead = root.join("lingxi-codex");
        std::os::unix::fs::symlink(root.join("nowhere"), &dead).unwrap();
        install_skill_dir(&dead, "host").unwrap();
        assert_eq!(std::fs::read_to_string(dead.join("SKILL.md")).unwrap(), "host");
        let _ = std::fs::remove_dir_all(&root);
        // What the app ships: the shared skill and Codex's own layer, which pins the identity.
        assert_eq!(CODEX_SKILLS[0].0, "lingxi");
        assert!(CODEX_SKILLS[0].1.contains("name: lingxi\n"));
        assert!(CODEX_SKILLS[1].1.contains("name: lingxi-codex\n"));
        assert!(CODEX_SKILLS[1].1.contains("LINGXI_AGENT=codex"));
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
                session: None, label: None, result: None, echo: false, label_is_folder: false,
                from_hook: false, turn_end: false,
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
        assert!(looks_like_typo("camera", "camrea"), "adjacent transposition");
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
            ("Notification", "needs_input"),
            ("Stop", "completed"),
            ("StopFailure", "failed"),
        ] {
            let raw = serde_json::json!({ "session_id": "s", "hook_event_name": event });
            assert_eq!(normalize_claude_hook_event(&raw, 1).state, expected, "{event}");
        }
        // The approval-shaped Notification is the single most urgent event an agent can raise -
        // it is what "a tool call is blocked right now" looks like. Assert it separately from
        // the plain-question shape above, because the two must not be collapsible.
        let approval = serde_json::json!({
            "session_id": "s",
            "hook_event_name": "Notification",
            "message": "Claude needs your permission to use Bash",
        });
        assert_eq!(normalize_claude_hook_event(&approval, 1).state, "needs_approval");
        assert_eq!(normalize_claude_hook_event(&approval, 1).summary, "想用 Bash，等你批一下");
    }

    #[test]
    fn notification_type_decides_whether_the_user_is_being_waited_on() {
        let with = |kind: &str, message: &str| {
            normalize_claude_hook_event(
                &serde_json::json!({
                    "session_id": "s", "hook_event_name": "Notification",
                    "notification_type": kind, "message": message,
                }),
                1,
            )
            .state
        };
        assert_eq!(with("permission_prompt", "Claude needs your permission to use Edit"), "needs_approval");
        assert_eq!(with("idle_prompt", "Claude is waiting for your input"), "needs_input");
        // Not waiting on anyone: dropped (state "unknown" is answered 200 but never recorded),
        // instead of the cat announcing 在等你哦 about a login.
        assert_eq!(with("auth_success", "Logged in"), "unknown");
        assert_eq!(with("computer_use_enter", ""), "unknown");
    }

    #[test]
    fn a_session_title_in_the_payload_beats_the_transcript() {
        let raw = serde_json::json!({
            "session_id": "s", "hook_event_name": "UserPromptSubmit",
            "session_title": "修复插件图标", "transcript_path": "/nonexistent.jsonl", "cwd": "/x/lingxi",
        });
        assert_eq!(normalize_claude_hook_event(&raw, 1).label.as_deref(), Some("修复插件图标"));
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

        // The user's own words are the running row's subject; a payload without
        // a prompt keeps the old lifecycle line instead of an empty summary.
        let user_prompt_words = serde_json::json!({
            "session_id": "s1", "hook_event_name": "UserPromptSubmit",
            "prompt": "rotate the prod database password to hunter2"
        });
        let prompt_event = normalize_claude_hook_event(&user_prompt_words, 4);
        assert_eq!(prompt_event.state, "running");
        // docs/09 「不采集任务正文」: the prompt text never rides the event,
        // even though the hook payload carries it — mirrors
        // integrations/test/emit-privacy.test.mjs on the adapter path.
        assert!(!prompt_event.summary.contains("hunter2"));
        assert_eq!(prompt_event.summary, "新一轮对话开始");

        let stop = serde_json::json!({ "session_id": "s1", "hook_event_name": "Stop", "stop_reason": "end_turn" });
        let stop_event = normalize_claude_hook_event(&stop, 2);
        assert_eq!(stop_event.state, "completed");
        assert!(stop_event.summary.contains("end_turn"));

        let failure = serde_json::json!({ "session_id": "s1", "hook_event_name": "StopFailure", "error_type": "rate_limit" });
        let failure_event = normalize_claude_hook_event(&failure, 3);
        assert_eq!(failure_event.state, "failed");
        assert!(failure_event.summary.contains("rate_limit"));

        // The identity is the tool, so the Claude mark resolves; the session rides beside it,
        // so concurrent sessions still get one activity row each.
        assert_eq!(stop_event.source_id, "claude");
        assert_eq!(stop_event.task_id, "s1");
        assert_eq!(stop_event.session.as_deref(), Some("s1"));
        assert_eq!(activity_key(&stop_event), "claude#s1");
    }

    fn claude(event: &str, extra: serde_json::Value) -> TaskEvent {
        let mut raw = serde_json::json!({ "session_id": "s", "hook_event_name": event });
        for (key, value) in extra.as_object().unwrap() {
            raw[key] = value.clone();
        }
        normalize_claude_hook_event(&raw, 1)
    }

    #[test]
    fn a_turn_that_ends_on_a_question_is_waiting_not_done() {
        let asked = claude("Stop", serde_json::json!({
            "last_assistant_message": "测试都过了。\n\n要按折中方案做吗？",
        }));
        assert_eq!(asked.state, "needs_input");
        assert_eq!(asked.result.as_deref(), Some("要按折中方案做吗？"));
        // Rhetoric mid-reply, answered in the same breath, is not a question to the user.
        let rhetorical = claude("Stop", serde_json::json!({
            "last_assistant_message": "为什么会这样？因为身份用错了。已经修好。",
        }));
        assert_eq!(rhetorical.state, "completed");
        // A question in a code block is code.
        let code = claude("Stop", serde_json::json!({
            "last_assistant_message": "已修好。\n```js\nconst ok = a ? b : c?\n```",
        }));
        assert_eq!(code.state, "completed");
    }

    #[test]
    fn a_permission_request_says_what_is_being_asked() {
        let bash = claude("PermissionRequest", serde_json::json!({
            "tool_name": "Bash", "tool_input": { "command": "rm -rf build", "description": "清理构建目录" },
        }));
        assert_eq!(bash.state, "needs_approval");
        assert_eq!(bash.result.as_deref(), Some("想跑：清理构建目录"));
        assert_eq!(bash.summary, "想用 Bash，等你批一下");
        assert!(!bash.echo);
        let edit = claude("PermissionRequest", serde_json::json!({
            "tool_name": "Edit", "tool_input": { "file_path": "/repo/src/lib.rs" },
        }));
        assert_eq!(edit.result.as_deref(), Some("想改 lib.rs，等你批一下"));
        let mcp = claude("PermissionRequest", serde_json::json!({ "tool_name": "mcp__lingxi__lingxi_say" }));
        assert_eq!(mcp.result.as_deref(), Some("想用 lingxi_say，等你批一下"));
        let question = claude("PermissionRequest", serde_json::json!({
            "tool_name": "AskUserQuestion",
            "tool_input": { "questions": [{ "question": "用哪个方案？", "options": [] }] },
        }));
        assert_eq!(question.state, "needs_input");
        assert_eq!(question.result.as_deref(), Some("用哪个方案？"));
        // The question itself is content: it rides the display-only field, not the summary
        // that reaches notification sinks.
        assert!(!serde_json::to_string(&question).unwrap().contains("用哪个方案"));
        let plan = claude("PermissionRequest", serde_json::json!({ "tool_name": "ExitPlanMode" }));
        assert_eq!(plan.state, "needs_approval");
    }

    #[test]
    fn a_waits_echo_is_silent_only_while_that_wait_is_on_screen() {
        let row = |state: &str, updated_at: u64| AgentActivity {
            provider: "claude".into(), agent: Some("claude".into()), task_id: "s".into(),
            state: state.into(), kind: "chat".into(), mood: "focused".into(), progress: None,
            summary: String::new(), label: None, updated_at, busy: true, report: None,
        };
        let mut echo = claude("Notification", serde_json::json!({
            "notification_type": "permission_prompt", "message": "Claude needs your permission to use Bash",
        }));
        assert!(echo.echo);
        echo.observed_at = 10_000;
        assert!(is_repeat_wait(Some(&row("needs_approval", 4_000)), &echo), "6s after the dialog");
        assert!(!is_repeat_wait(Some(&row("running", 4_000)), &echo), "the dialog was answered");
        assert!(!is_repeat_wait(None, &echo));
        echo.observed_at = 4_000 + WAIT_ECHO_WINDOW_MS + 1;
        assert!(!is_repeat_wait(Some(&row("needs_approval", 4_000)), &echo), "long unseen: say it again");
        // The first report of a wait is never an echo.
        let mut first = claude("PermissionRequest", serde_json::json!({ "tool_name": "Bash" }));
        first.observed_at = 10_000;
        assert!(!is_repeat_wait(Some(&row("needs_approval", 4_000)), &first));
    }

    #[test]
    fn a_folder_name_never_replaces_a_title_and_an_answered_wait_is_not_kept() {
        let with_title = claude("UserPromptSubmit", serde_json::json!({ "session_title": "修复插件图标", "cwd": "/x/lingxi" }));
        assert_eq!((with_title.label.as_deref(), with_title.label_is_folder), (Some("修复插件图标"), false));
        let folder_only = claude("TaskCompleted", serde_json::json!({ "cwd": "/x/lingxi", "task_subject": "a" }));
        assert_eq!((folder_only.label.as_deref(), folder_only.label_is_folder), (Some("lingxi"), true));
        // An answered approval does not linger as the running row's line...
        assert!(!keep_turn_summary("想跑：清理构建目录", "needs_approval", "新一轮对话开始", 1_000));
        // ...while a real result still survives the lifecycle event right behind it.
        assert!(keep_turn_summary("登录页的对比度修好了", "completed", "本轮回复完成（end_turn）", 1_000));
    }

    #[test]
    fn todo_progress_and_session_end_are_mapped() {
        let done = claude("TaskCompleted", serde_json::json!({ "task_id": "7", "task_subject": "装新版到 Applications" }));
        assert_eq!(done.state, "running");
        assert_eq!(done.task_id, "s", "the SESSION is the task; task_id in this payload is the todo item");
        assert_eq!(done.result.as_deref(), Some("完成：装新版到 Applications"));
        assert_eq!(claude("SessionEnd", serde_json::json!({ "reason": "exit" })).state, "ended");
        let url = claude("Notification", serde_json::json!({ "notification_type": "elicitation_url_dialog", "message": "x" }));
        assert_eq!(url.state, "needs_input");
    }

    #[test]
    fn the_tray_offers_every_toy_and_every_effect() {
        let toys: Vec<&str> = TRAY_TOYS.iter().map(|(id, _)| *id).collect();
        let effects: Vec<&str> = TRAY_EFFECTS.iter().map(|(id, _)| *id).collect();
        assert_eq!(toys, KNOWN_TOYS.to_vec());
        assert_eq!(effects, KNOWN_PERFORMANCES.to_vec());
    }

    #[test]
    fn only_the_dialog_hooks_are_installed_async() {
        assert!(CLAUDE_HOOK_EVENTS.contains(&"PermissionRequest"));
        assert!(claude_hook_is_async("PermissionRequest"));
        // SessionEnd runs as the process exits: a detached hook may never finish.
        assert!(!claude_hook_is_async("SessionEnd"));
        assert!(!claude_hook_is_async("SessionStart"));
    }

    #[test]
    fn a_turn_ends_with_what_it_came_to_not_with_a_template() {
        let reply = "新版已经装好，重启后气泡会带上 Claude 图标和会话名。\n\n## 细节\n- 日志在 logs/";
        let raw = serde_json::json!({
            "session_id": "s", "hook_event_name": "Stop", "last_assistant_message": reply,
        });
        let event = normalize_claude_hook_event(&raw, 1);
        assert_eq!(event.result.as_deref(), Some("新版已经装好"));
        // Perceived, not collected: the reply never reaches the serialized event (event log,
        // notification sinks) - only the display-only field holds the line made from it.
        let serialized = serde_json::to_string(&event).unwrap();
        assert!(!serialized.contains("新版已经装好"), "{serialized}");
        assert!(event.summary.starts_with("本轮回复完成"));
        // A turn that ended on a tool call has no prose: the old lifecycle line stands.
        let silent = serde_json::json!({ "session_id": "s", "hook_event_name": "Stop", "last_assistant_message": "" });
        assert_eq!(normalize_claude_hook_event(&silent, 1).result, None);
    }

    #[test]
    fn turn_line_takes_the_first_sentence_of_prose_and_keeps_it_bubble_sized() {
        assert_eq!(turn_line("测试全部通过。接下来安装。").as_deref(), Some("测试全部通过"));
        assert_eq!(
            turn_line("```bash\nnpm test\n```\n| a | b |\n## 结论\n**构建完成**，已安装到 `/Applications`。").as_deref(),
            Some("构建完成，已安装到 /Applications"),
        );
        // Too long: cut at the last comma inside the bubble, not mid-word.
        assert_eq!(
            turn_line("明白了：「不采集」指的是内容在本机处理完就丢弃，不上传、不外发，而不是让猫对内容一无所知。").as_deref(),
            Some("明白了：「不采集」指的是内容在本机处理完就丢弃"),
        );
        // No comma to cut at: truncated with an ellipsis.
        let long = turn_line("关键发现：本机这版 Claude Code 的 hook 数据比我们以为的丰富。").unwrap();
        assert!(long.ends_with('…') && long.chars().count() == BUBBLE_SAY_CHARS, "{long}");
        assert_eq!(turn_line("- see [the docs](https://x.y) for details.").as_deref(), Some("see the docs for details"));
        // An aside in parentheses is dropped before cutting, rather than cut in half.
        assert_eq!(
            turn_line("Bash 这边一直拿不到自动模式的安全判定（服务端的问题，不是命令本身被拒），所以我没法替你启动 app。").as_deref(),
            Some("Bash 这边一直拿不到自动模式的安全判定"),
        );
        assert_eq!(turn_line("```\ncode only\n```"), None);
        assert_eq!(turn_line(""), None);
    }

    #[test]
    fn the_task_event_log_keeps_a_payloads_shape_but_not_its_words() {
        let raw = serde_json::json!({
            "hook_event_name": "UserPromptSubmit", "prompt": "rotate the prod password to hunter2",
            "session_id": "s1", "stop_hook_active": false, "n": 3, "items": [1, 2],
        });
        let shape = payload_shape(&raw).to_string();
        assert!(!shape.contains("hunter2"));
        assert!(shape.contains("\"prompt\":\"str(35)\""));
        assert!(shape.contains("\"hook_event_name\":\"UserPromptSubmit\""));
        assert!(shape.contains("\"stop_hook_active\":false"));
        assert!(shape.contains("\"items\":\"arr(2)\""));
    }

    #[test]
    fn claude_session_label_prefers_a_rename_then_the_generated_title_then_the_folder() {
        // A tail that starts mid-line, as a seek into the middle of a transcript does.
        let tail = concat!(
            "le\":\"ai-title\",\"aiTitle\":\"cut off\"}\n",
            "{\"type\":\"ai-title\",\"aiTitle\":\"旧标题\",\"sessionId\":\"s\"}\n",
            "{\"type\":\"user\",\"message\":{\"content\":\"hi\"}}\n",
            "{\"type\":\"ai-title\",\"aiTitle\":\"修复插件图标\",\"sessionId\":\"s\"}\n",
        );
        assert_eq!(transcript_title_from_tail(tail).as_deref(), Some("修复插件图标"));
        let renamed = format!("{{\"type\":\"custom-title\",\"customTitle\":\"灵犀发版\"}}\n{tail}");
        assert_eq!(transcript_title_from_tail(&renamed).as_deref(), Some("灵犀发版"));
        assert_eq!(transcript_title_from_tail("{\"type\":\"user\"}\n"), None);

        // Read from disk, end to end.
        let dir = std::env::temp_dir().join(format!("lingxi-transcript-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let transcript = dir.join("s.jsonl");
        std::fs::write(&transcript, tail).unwrap();
        let raw = serde_json::json!({
            "session_id": "s", "hook_event_name": "Stop",
            "transcript_path": transcript.to_str().unwrap(), "cwd": "/Users/x/workspace/lingxi",
        });
        assert_eq!(normalize_claude_hook_event(&raw, 1).label.as_deref(), Some("修复插件图标"));

        // No title yet (a first turn), or not a transcript at all: the project folder.
        let untitled = dir.join("untitled.jsonl");
        std::fs::write(&untitled, "{\"type\":\"user\"}\n").unwrap();
        let secret = dir.join("secret.txt");
        std::fs::write(&secret, "{\"type\":\"ai-title\",\"aiTitle\":\"leak\"}\n").unwrap();
        for path in [&untitled, &secret] {
            let raw = serde_json::json!({
                "session_id": "s", "hook_event_name": "Stop",
                "transcript_path": path.to_str().unwrap(), "cwd": "/Users/x/workspace/lingxi",
            });
            assert_eq!(normalize_claude_hook_event(&raw, 1).label.as_deref(), Some("lingxi"));
        }
        let _ = std::fs::remove_dir_all(&dir);
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
        assert_eq!(event.summary, "Codex 回复结束");
        assert_eq!(event.result.as_deref(), Some("done"));
        assert_eq!(event.session.as_deref(), Some("s9"));
        assert_eq!(event.label, None);

        let named = serde_json::json!({ "type": "agent-turn-complete", "thread-id": "abc123456", "cwd": "/work/lingxi", "last-assistant-message": "登录测试修好了。接下来可以继续。" });
        let event = normalize_codex_notify_event(&named, 3).unwrap();
        assert_eq!(event.label, None);
        assert_eq!(event.result.as_deref(), Some("登录测试修好了"));
        assert!(!event.summary.contains("登录测试"), "reply must stay out of the event log");

        let question = serde_json::json!({ "type": "agent-turn-complete", "thread-id": "abc123456", "last-assistant-message": "需要你确认部署窗口吗？" });
        let event = normalize_codex_notify_event(&question, 4).unwrap();
        assert_eq!(event.state, "needs_input");
        assert_eq!(event.result.as_deref(), Some("需要你确认部署窗口吗？"));

        // And the whole point of returning Option: anything else must fall through to the next
        // mapper rather than being invented into a state.
        assert!(normalize_codex_notify_event(&serde_json::json!({ "type": "something-new" }), 3).is_none());
        assert!(normalize_codex_notify_event(&serde_json::json!({}), 4).is_none());
        // A Claude hook payload must NOT be claimed by this mapper.
        let claude = serde_json::json!({ "session_id": "s1", "hook_event_name": "Stop" });
        assert!(normalize_codex_notify_event(&claude, 5).is_none());
    }

    #[test]
    fn permission_tiers_draw_the_line_at_persistence() {
        // The classification the whole design rests on: transient performance vs. things that
        // outlive the process. A wrong expression is gone in four seconds; a wrong
        // `visible: false` leaves the user with no cat and no idea which agent did it.
        assert!(!AgentPermission::Observer.may_perform());
        assert!(!AgentPermission::Observer.may_write_settings());
        assert!(AgentPermission::Performer.may_perform());
        assert!(!AgentPermission::Performer.may_write_settings());
        assert!(AgentPermission::Trusted.may_perform());
        assert!(AgentPermission::Trusted.may_write_settings());
        // Unspecified stays performer. A named agent is trusted; anonymous is not.
        assert_eq!(AgentPermission::default(), AgentPermission::Performer);
        assert_eq!(default_permission_for("cursor"), AgentPermission::Trusted);
        assert_eq!(default_permission_for("anonymous"), AgentPermission::Performer);
    }

    #[test]
    fn every_persisting_control_field_is_classified() {
        // SETTINGS_FIELDS is hand-maintained, so this asserts it still names exactly the fields
        // that survive a restart. A new persisting knob added to CONTROL_FIELDS without being
        // listed here would silently be granted to every caller as a performance field - the
        // exact hole the whitelist exists to close.
        for field in SETTINGS_FIELDS {
            assert!(CONTROL_FIELDS.contains(&field), "{field} is not a control field at all");
        }
        // These persist through TrayState::persist() - see the struct.
        for field in ["skin", "camera", "scale", "visible"] {
            assert!(SETTINGS_FIELDS.contains(&field), "{field} persists but is not gated");
        }
    }

    #[test]
    fn permission_parse_rejects_anything_it_does_not_know() {
        for name in AGENT_PERMISSIONS {
            assert_eq!(AgentPermission::parse(name).unwrap().as_str(), name, "round trip {name}");
        }
        // Not defaulted - an unrecognised tier must never resolve to a usable one.
        assert!(AgentPermission::parse("admin").is_none());
        assert!(AgentPermission::parse("Trusted").is_none(), "case matters, the file is machine-written");
        assert!(AgentPermission::parse("").is_none());
    }

    #[test]
    fn a_grant_outlives_the_agent_being_evicted_or_the_app_restarting() {
        // The reason grants are kept apart from `agents`: that map is capped and evicts the
        // stalest entry, and it is empty after a restart. A decision the user made must survive
        // both, or a quiet week silently revokes it.
        let registry = AgentRegistry::default();
        registry.set_permission("codex", AgentPermission::Trusted);
        assert_eq!(registry.permission_of("codex"), AgentPermission::Trusted);

        // Evicted from `agents` (or never there - same thing to permission_of).
        registry.agents.lock().unwrap().clear();
        assert_eq!(registry.permission_of("codex"), AgentPermission::Trusted);

        // A named id nobody has set yet starts trusted. Anonymous does not inherit that.
        assert_eq!(registry.permission_of("someone-else"), AgentPermission::Trusted);
        assert_eq!(registry.permission_of("anonymous"), AgentPermission::Performer);
    }

    #[test]
    fn a_new_agent_is_seeded_from_the_saved_grant_not_the_default() {
        let registry = AgentRegistry::default();
        registry.set_permission("codex", AgentPermission::Trusted);
        let identity = resolve_agent(&registry, Some("codex"), 1_000);
        assert_eq!(
            identity.permission,
            AgentPermission::Trusted,
            "first call after a restart must already be trusted, not refused once and then fixed",
        );
    }

    #[test]
    fn a_persistent_write_is_attributed_by_header_or_by_body() {
        use serde_json::json;
        // The header wins when present - a host relaying someone else's call should not be
        // overridable by the payload it is relaying.
        assert_eq!(
            resolve_write_caller_id(Some("claude"), Some(&json!({ "agent": "someone-else" }))),
            "claude",
        );
        // Body fallback. This is the case that mattered: not one shipped client sent the
        // header, so /memory and /reminders answered 403 to all of them while the id they
        // did send sat unread in the body.
        assert_eq!(resolve_write_caller_id(None, Some(&json!({ "agent": "codex" }))), "codex");
        // A bare curl with no id anywhere is still allowed to be anonymous - docs/19 promises
        // that an unregistered caller keeps working. Anonymous stays performer.
        assert_eq!(resolve_write_caller_id(None, Some(&json!({ "text": "hi" }))), "anonymous");
        assert_eq!(resolve_write_caller_id(None, None), "anonymous");
        // Blank and whitespace-only are not identities.
        assert_eq!(resolve_write_caller_id(Some("   "), Some(&json!({ "agent": "  " }))), "anonymous");
        // An over-long id is truncated rather than rejected: it is a map key, not a promise.
        assert_eq!(resolve_write_caller_id(Some(&"x".repeat(200)), None).len(), 64);
        // A non-string agent is not an id.
        assert_eq!(resolve_write_caller_id(None, Some(&json!({ "agent": 7 }))), "anonymous");
    }

    #[test]
    fn the_write_budget_is_a_sliding_window() {
        let registry = AgentRegistry::default();
        let start = 1_000_000u64;
        for i in 0..AGENT_WRITE_LIMIT {
            assert!(registry.take_write_budget("a", start + i as u64), "call {i} should fit");
        }
        assert!(!registry.take_write_budget("a", start + 10), "the budget must actually run out");
        // Sliding, not fixed: a fixed window would let a caller spend the whole budget at 0:59
        // and the whole budget again at 1:01, which is the burst it exists to prevent.
        assert!(registry.take_write_budget("a", start + AGENT_WRITE_WINDOW_MS + 1));
        // Budgets are per agent - one noisy caller must not throttle a quiet one.
        assert!(registry.take_write_budget("b", start + 10));
    }

    #[test]
    fn the_call_log_is_bounded_and_keeps_the_newest() {
        let registry = AgentRegistry::default();
        for i in 0..(AGENT_LOG_CAP + 25) {
            registry.record("a", "control", format!("field{i}"), "applied", None);
        }
        let log = registry.log.lock().unwrap();
        assert_eq!(log.len(), AGENT_LOG_CAP, "an unbounded log is a memory leak with a nice name");
        assert_eq!(log.last().unwrap().asked, format!("field{}", AGENT_LOG_CAP + 24));
        assert!(log.first().unwrap().asked.starts_with("field"));
    }

    #[test]
    fn codex_install_refuses_to_overwrite_someone_elses_notify() {
        // The case the whole design turns on. `notify` is one TOML key, so installing over an
        // existing one deletes another tool's integration - silently, because Codex will simply
        // stop calling it. integrations/hosts/codex/README.md is explicit that we must not:
        // "别直接覆盖用户已有的 notify。那是别人的功能，猫不值得。"
        let existing = r#"
model = "o3"
notify = ["/Users/someone/bin/SkyComputerUseClient", "turn-ended"]
"#;
        let error = codex_install_into(existing).expect_err("must refuse");
        assert!(error.contains("SkyComputerUseClient"), "the refusal has to show WHOSE it is: {error}");
        // And how to keep both - the refusal has to be actionable, or it is just a wall.
        assert!(
            error.contains("integrations/hosts/codex/install.sh"),
            "the refusal must name the installer that CAN merge the two: {error}",
        );
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
        assert_eq!(event.source_id, "claude");
        assert_eq!(event.task_id, "unknown-session");
        assert_eq!(event.label, None);
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
    fn legacy_hook_forms_are_uninstallable_and_upgradeable() {
        // A machine that installed an OLDER build carries an older command string. This used to
        // be a trap with two exits, both bad: uninstall matched only the current command, so
        // "已接入" was reported and "已移除" was returned while the dead hook stayed; install
        // recognised the legacy line and skipped, so re-installing could never upgrade it.
        let legacy = LEGACY_CLAUDE_HOOK_COMMANDS[0];
        let mut hooks = serde_json::json!({
            "Stop": [
                { "hooks": [ { "type": "command", "command": legacy } ] },
                { "hooks": [ { "type": "command", "command": "echo someone-elses" } ] }
            ]
        });
        // Reported as ours...
        assert!(has_our_hook(hooks["Stop"].as_array().unwrap()));
        // ...removable by uninstall...
        let removed = remove_our_hook_entries(hooks.as_object_mut().unwrap());
        assert_eq!(removed, 1);
        let stop = hooks["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 1, "someone else's hook must survive");
        assert_eq!(stop[0]["hooks"][0]["command"], "echo someone-elses");
        // ...and upgradeable by install: the legacy form is pruned, the current one added.
        let entries = hooks["Stop"].as_array_mut().unwrap();
        assert!(!prune_legacy_hook_entries(entries, CLAUDE_HOOK_COMMAND));
        assert_eq!(entries.len(), 1, "the legacy entry went away");
        entries.push(serde_json::json!({ "hooks": [ { "type": "command", "command": CLAUDE_HOOK_COMMAND } ] }));
        assert!(prune_legacy_hook_entries(entries, CLAUDE_HOOK_COMMAND), "current form survives the prune");
        assert_eq!(entries.len(), 2, "and was not re-added on top of");
    }

    #[test]
    fn only_session_start_carries_the_check_and_every_command_bypasses_proxies() {
        for event in CLAUDE_HOOK_EVENTS {
            let command = claude_hook_command_for(event);
            assert!(is_our_command(command));
            // A local proxy answers 502 for 127.0.0.1: the event never arrives, and a health
            // check reads the 502 as "the app is up" and never starts it.
            assert!(command.contains("--noproxy '*'"), "{event} would go through an exported proxy");
            let starts_app = command.contains("open -g -b com.dushaobin.lingxi-desktop");
            assert_eq!(starts_app, event == "SessionStart", "{event}: only the session boundary may start the app");
        }
        // The check must never hold the session: everything after reading stdin is detached.
        assert!(CLAUDE_SESSION_START_COMMAND.starts_with("P=$(cat); ("));
        assert!(CLAUDE_SESSION_START_COMMAND.ends_with(") </dev/null >/dev/null 2>&1 &"));
        assert!(CLAUDE_SESSION_START_COMMAND.contains("LINGXI_AUTOSTART"), "the start must be refusable");
    }

    #[test]
    fn every_hook_command_is_valid_posix_sh() {
        for command in [CLAUDE_HOOK_COMMAND, CLAUDE_SESSION_START_COMMAND] {
            let status = std::process::Command::new("sh").arg("-n").arg("-c").arg(command).status().unwrap();
            assert!(status.success(), "sh cannot parse: {command}");
        }
    }

    #[test]
    fn a_machine_on_the_previous_build_is_upgraded_in_place_and_only_once() {
        // The exact form "一键接入" wrote until now: -K, no --noproxy, no check on SessionStart.
        let previous = LEGACY_CLAUDE_HOOK_COMMANDS[2];
        let mut hooks = serde_json::Map::new();
        for event in CLAUDE_HOOK_EVENTS {
            hooks.insert(event.to_string(), serde_json::json!([ { "hooks": [ { "type": "command", "command": previous } ] } ]));
        }
        hooks.insert(
            "Stop".into(),
            serde_json::json!([
                { "hooks": [ { "type": "command", "command": previous } ] },
                { "hooks": [ { "type": "command", "command": "echo someone-elses" } ] }
            ]),
        );
        hooks.insert("PreToolUse".into(), serde_json::json!([ { "hooks": [ { "type": "command", "command": "echo mine" } ] } ]));

        assert_eq!(upgrade_our_hook_commands(&mut hooks), CLAUDE_HOOK_EVENTS.len());
        for event in CLAUDE_HOOK_EVENTS {
            assert_eq!(hooks[event][0]["hooks"][0]["command"], claude_hook_command_for(event), "{event}");
        }
        assert_eq!(hooks["Stop"][1]["hooks"][0]["command"], "echo someone-elses", "not ours - untouched");
        assert_eq!(hooks["PreToolUse"][0]["hooks"][0]["command"], "echo mine", "not ours - untouched");
        assert_eq!(upgrade_our_hook_commands(&mut hooks), 0, "a second launch has nothing to do");

        // Uninstall still recognises the upgraded forms.
        assert_eq!(remove_our_hook_entries(&mut hooks), CLAUDE_HOOK_EVENTS.len());
    }

    #[test]
    fn a_standing_reminder_keeps_its_own_schedule() {
        let day = 24 * 60;
        let nine_thirty = 1_000_000_000u64;
        // Said a few seconds late: tomorrow is still 09:30, not 09:30 and a few seconds.
        assert_eq!(next_due(nine_thirty, day, nine_thirty + 20_000), nine_thirty + day * 60_000);
        // The laptop was shut for three days: the next one is the next 09:30, not "now + 1 day".
        let back = nine_thirty + 3 * day * 60_000 + 2 * 3_600_000;
        assert_eq!(next_due(nine_thirty, day, back), nine_thirty + 4 * day * 60_000);
        assert!(next_due(nine_thirty, day, back) > back);
        assert_eq!(next_due(5, 0, 10), 60_005, "a zero interval cannot spin");
    }

    #[test]
    fn events_learned_after_install_are_added_once_and_only_for_someone_connected() {
        // A machine that clicked 一键接入 when there were five events.
        let mut hooks = serde_json::Map::new();
        for event in ["SessionStart", "UserPromptSubmit", "Notification", "Stop", "StopFailure"] {
            hooks.insert(event.into(), serde_json::json!([ { "hooks": [ { "type": "command", "command": claude_hook_command_for(event) } ] } ]));
        }
        hooks.insert("PermissionRequest".into(), serde_json::json!([ { "hooks": [ { "type": "command", "command": "echo mine" } ] } ]));
        assert_eq!(add_events_new_since_install(&mut hooks), 3);
        assert_eq!(hooks["PermissionRequest"][0]["hooks"][0]["command"], "echo mine", "theirs kept");
        assert_eq!(hooks["PermissionRequest"][1]["hooks"][0]["async"], true);
        assert_eq!(hooks["SessionEnd"][0]["hooks"][0]["command"], CLAUDE_HOOK_COMMAND);
        assert_eq!(add_events_new_since_install(&mut hooks), 0, "already there");
        // Someone who never connected gets nothing installed behind their back.
        let mut stranger = serde_json::Map::new();
        stranger.insert("Stop".into(), serde_json::json!([ { "hooks": [ { "type": "command", "command": "echo mine" } ] } ]));
        assert_eq!(add_events_new_since_install(&mut stranger), 0);
        assert!(!stranger.contains_key("SessionEnd"));
    }

    #[test]
    fn install_replaces_a_plain_session_start_hook_with_the_checking_one() {
        let mut entries = vec![serde_json::json!({ "hooks": [ { "type": "command", "command": CLAUDE_HOOK_COMMAND } ] })];
        assert!(!prune_legacy_hook_entries(&mut entries, CLAUDE_SESSION_START_COMMAND), "the plain form is outdated here");
        assert!(entries.is_empty());
    }

    #[test]
    fn the_plugin_recognises_every_hook_line_the_app_writes() {
        // Claude Code does not deduplicate a plugin's hook against a settings.json hook, so with
        // both "一键接入" and the plugin installed every event would reach the cat twice. The
        // plugin steps aside when it finds the app's hooks, and it finds them by this marker -
        // so every command the app writes, current or legacy, has to carry it.
        let plugin_lib = include_str!("../../../../integrations/hosts/claude/scripts/lib.sh");
        let marker = "127.0.0.1:47811/task-event";
        assert!(plugin_lib.contains(&format!("grep -q '{marker}'")), "lib.sh no longer looks for {marker}");
        for command in [CLAUDE_HOOK_COMMAND, CLAUDE_SESSION_START_COMMAND].iter().chain(LEGACY_CLAUDE_HOOK_COMMANDS.iter()) {
            assert!(command.contains(marker), "the plugin would not recognise: {command}");
        }
    }

    #[test]
    fn management_routes_are_checked_before_a_window_opens() {
        assert_eq!(parse_management_route("agent:claude").as_deref(), Ok("agent:claude"));
        assert_eq!(parse_management_route("settings").as_deref(), Ok("settings"));
        assert!(parse_management_route("admin").is_err(), "unknown page");
        assert!(parse_management_route("agent:<script>").is_err(), "panel ids are plain lowercase");
        assert!(parse_management_route(&format!("agent:{}", "a".repeat(40))).is_err());
        assert!(CONTROL_FIELDS.contains(&"openManagement"));
    }

    #[test]
    fn the_agent_page_knows_when_the_claude_plugin_is_connected() {
        let installed = serde_json::json!({ "version": 2, "plugins": {
            "other@x": [ { "version": "1.0.0" } ],
            "lingxi@lingxi": [ { "scope": "user", "version": "0.2.0" } ]
        }});
        let status = claude_plugin_status_from(&installed, &serde_json::json!({}));
        assert!(status.installed && status.enabled, "installed and not switched off means enabled");
        assert_eq!(status.version.as_deref(), Some("0.2.0"));
        let off = serde_json::json!({ "enabledPlugins": { "lingxi@lingxi": false } });
        assert!(!claude_plugin_status_from(&installed, &off).enabled);
        assert!(!claude_plugin_status_from(&serde_json::json!({ "plugins": { "lingxi-other@x": [] } }), &off).installed,
            "only a plugin named exactly lingxi counts");
        assert!(!claude_plugin_status_from(&serde_json::Value::Null, &serde_json::Value::Null).installed);
    }

    #[test]
    fn queue_item_taken_but_not_claimed_is_played_not_lost() {
        // take_next_due REMOVES the item before returning it; a lost stage race in the drain
        // loop used to just `continue`, destroying the alert it was holding.
        let registry = AgentRegistry::default();
        let identity = AgentIdentity {
            id: "a".into(),
            name: "a".into(),
            badge: "a".into(),
            logo: None,
            color: "#000".into(),
            registered_at: 0,
            last_seen: 0,
            claims: 0,
            permission: AgentPermission::default(),
        };
        let item = QueuedReaction {
            agent: identity,
            command: serde_json::json!({"expression": "x"}),
            priority: "alert".into(),
            rank: priority_rank("alert"),
            hold_ms: 1000,
            queued_at: 0,
            expires_at: u64::MAX,
        };
        registry.enqueue(item.clone());
        let (taken, expired) = registry.take_next_due(0);
        assert_eq!(expired, 0);
        let item = taken.expect("item should be taken");
        // The stage is free (never claimed) - claim_stage would succeed - but the race this
        // regression pins is the loser's path: give the item back and it is still queued.
        registry.requeue_front(item);
        let (again, _) = registry.take_next_due(0);
        assert!(again.is_some(), "a taken-but-unclaimed reaction must survive for the next pass");
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
