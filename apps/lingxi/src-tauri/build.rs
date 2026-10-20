fn main() {
    // A test build keeps the tray's 特效 submenu (see build_tray): baked in at compile time, so a change must rebuild.
    println!("cargo:rerun-if-env-changed=VITE_LINGXI_DEV_EFFECTS");
    tauri_build::build()
}
