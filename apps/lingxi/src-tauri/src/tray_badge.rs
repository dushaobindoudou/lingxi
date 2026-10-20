// On macOS tray-icon 0.24.2 ignores None instead of clearing NSStatusItem's
// existing title. Explicit empty text is required to remove the unread number.
// The native probe imports this same argument mapping and reads the real title.
pub fn attention_title(count: usize) -> Option<String> {
    Some(if count == 0 { String::new() } else { count.to_string() })
}
