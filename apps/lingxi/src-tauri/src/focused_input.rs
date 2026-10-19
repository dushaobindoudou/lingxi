//! Focus geometry only. Never request AXValue/AXSelectedText, read keys, or retain text.
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    fn valid(self, caret: bool) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.height > 0.0
            && if caret {
                self.width >= 0.0
            } else {
                self.width > 0.0
            }
    }
    fn scaled(self, scale: f64) -> Self {
        Self {
            x: self.x * scale,
            y: self.y * scale,
            width: self.width * scale,
            height: self.height * scale,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FocusedInput {
    pub field: Rect,
    pub caret: Option<Rect>,
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use std::ffi::c_void;
    use std::ptr;
    type Element = CFTypeRef;
    #[repr(C)]
    #[derive(Default)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Size {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Bounds {
        origin: Point,
        size: Size,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Range {
        location: isize,
        length: isize,
    }
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> Element;
        fn AXUIElementCopyAttributeValue(
            element: Element,
            name: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        fn AXUIElementCopyParameterizedAttributeValue(
            element: Element,
            name: CFStringRef,
            parameter: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> i32;
        fn AXUIElementSetMessagingTimeout(element: Element, seconds: f32) -> i32;
        fn AXUIElementGetTypeID() -> usize;
        fn AXValueGetTypeID() -> usize;
        fn AXValueGetType(value: CFTypeRef) -> u32;
        fn AXValueGetValue(value: CFTypeRef, kind: u32, result: *mut c_void) -> u8;
        fn AXValueCreate(kind: u32, value: *const c_void) -> CFTypeRef;
    }
    fn attribute(element: Element, name: &str) -> Option<CFType> {
        let mut value = ptr::null();
        let name = CFString::new(name);
        let error = unsafe {
            AXUIElementCopyAttributeValue(element, name.as_concrete_TypeRef(), &mut value)
        };
        if error != 0 || value.is_null() {
            None
        } else {
            Some(unsafe { CFType::wrap_under_create_rule(value) })
        }
    }
    fn string_attribute(element: Element, name: &str) -> Option<String> {
        attribute(element, name)?
            .downcast::<CFString>()
            .map(|s| s.to_string())
    }
    fn geometry<T: Default>(value: &CFType, kind: u32) -> Option<T> {
        if value.type_of() != unsafe { AXValueGetTypeID() }
            || unsafe { AXValueGetType(value.as_CFTypeRef()) } != kind
        {
            return None;
        }
        let mut result = T::default();
        (unsafe {
            AXValueGetValue(
                value.as_CFTypeRef(),
                kind,
                &mut result as *mut T as *mut c_void,
            )
        } != 0)
            .then_some(result)
    }
    fn field_rect(element: Element) -> Option<Rect> {
        let p: Point = geometry(&attribute(element, "AXPosition")?, 1)?;
        let s: Size = geometry(&attribute(element, "AXSize")?, 2)?;
        let r = Rect {
            x: p.x,
            y: p.y,
            width: s.width,
            height: s.height,
        };
        r.valid(false).then_some(r)
    }
    fn caret_rect(element: Element) -> Option<Rect> {
        let selected: Range = geometry(&attribute(element, "AXSelectedTextRange")?, 4)?;
        if selected.location < 0 {
            return None;
        }
        // Query only the insertion point, even when a large selection exists.
        let range = Range {
            location: selected.location,
            length: 0,
        };
        let parameter = unsafe { AXValueCreate(4, &range as *const Range as *const c_void) };
        if parameter.is_null() {
            return None;
        }
        let parameter = unsafe { CFType::wrap_under_create_rule(parameter) };
        let mut value = ptr::null();
        let name = CFString::new("AXBoundsForRange");
        let error = unsafe {
            AXUIElementCopyParameterizedAttributeValue(
                element,
                name.as_concrete_TypeRef(),
                parameter.as_CFTypeRef(),
                &mut value,
            )
        };
        if error != 0 || value.is_null() {
            return None;
        }
        let value = unsafe { CFType::wrap_under_create_rule(value) };
        let b: Bounds = geometry(&value, 3)?;
        let r = Rect {
            x: b.origin.x,
            y: b.origin.y,
            width: b.size.width,
            height: b.size.height,
        };
        r.valid(true).then_some(r)
    }
    pub fn sample(scale: f64) -> Option<FocusedInput> {
        if !scale.is_finite()
            || scale <= 0.0
            || !macos_accessibility_client::accessibility::application_is_trusted()
        {
            return None;
        }
        let system = unsafe { AXUIElementCreateSystemWide() };
        if system.is_null() {
            return None;
        }
        let system = unsafe { CFType::wrap_under_create_rule(system) };
        // A hung foreground app must never stall the renderer or main thread. Called only
        // from our sampler thread; each foreign messaging round trip is bounded to 50ms.
        unsafe {
            AXUIElementSetMessagingTimeout(system.as_CFTypeRef(), 0.05);
        }
        let element = attribute(system.as_CFTypeRef(), "AXFocusedUIElement")?;
        if element.type_of() != unsafe { AXUIElementGetTypeID() } {
            return None;
        }
        let element = element.as_CFTypeRef();
        unsafe {
            AXUIElementSetMessagingTimeout(element, 0.05);
        }
        let role = string_attribute(element, "AXRole")?;
        if !matches!(role.as_str(), "AXTextField" | "AXTextArea" | "AXComboBox") {
            return None;
        }
        let field = field_rect(element)?;
        let secure = string_attribute(element, "AXSubrole").as_deref() == Some("AXSecureTextField");
        let caret = if secure { None } else { caret_rect(element) };
        Some(FocusedInput {
            field: field.scaled(scale),
            caret: caret.map(|r| r.scaled(scale)),
        })
    }
}
#[cfg(target_os = "macos")]
pub use native::sample;
#[cfg(not(target_os = "macos"))]
pub fn sample(_scale: f64) -> Option<FocusedInput> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zero_width_caret_and_negative_monitor_coordinates_are_valid() {
        let r = Rect {
            x: -500.0,
            y: 20.0,
            width: 0.0,
            height: 18.0,
        };
        assert!(r.valid(true));
        assert!(!r.valid(false));
        assert_eq!(r.scaled(2.0).x, -1000.0);
        assert!(!Rect { x: f64::NAN, ..r }.valid(true));
    }
}
