import type { FocusedInput, WorkArea } from '../../../packages/desktop-host-contract/index.d.ts';
export interface InputRect { x: number; y: number; width: number; height: number }
export interface BodyExtent { above: number; below: number; halfWidth: number }

/** AX uses global screen points; the native host reports physical pixels like the cursor. */
export function inputProtectedRegions(input: FocusedInput | null, area: WorkArea, body: BodyExtent): InputRect[] {
  if (!input || !Number.isFinite(area.scaleFactor) || area.scaleFactor <= 0) return [];
  const sf = area.scaleFactor;
  const convert = (r: InputRect) => ({ x: (r.x - area.x) / sf, y: (r.y - area.y) / sf, width: r.width / sf, height: r.height / sf });
  const field = convert(input.field);
  if (!Object.values(field).every(Number.isFinite) || field.width <= 0 || field.height <= 0) return [];
  const width = area.width / sf, height = area.height / sf;
  const x = Math.max(0, field.x), y = Math.max(0, field.y);
  const right = Math.min(width, field.x + field.width), bottom = Math.min(height, field.y + field.height);
  if (right <= x || bottom <= y) return []; // another monitor, never clamp it onto this one
  let protectedField = { x, y, width: right - x, height: bottom - y };
  const caret = input.caret ? convert(input.caret) : null;
  if (field.height > 320 && field.width * field.height > width * height * 0.18 && caret
    && Object.values(caret).every(Number.isFinite) && caret.height > 0 && caret.height < 120
    && caret.y >= y && caret.y < bottom && caret.x >= x && caret.x <= right) {
    // A full-window editor is different from a chat box: protect its active line, leaving
    // room on the rest of the desktop. Unsupported caret geometry keeps the whole field safe.
    protectedField = { x, y: Math.max(y, caret.y - 12), width: right - x, height: Math.min(bottom, caret.y + caret.height + 12) - Math.max(y, caret.y - 12) };
  }
  const padding = 16;
  return [{
    x: protectedField.x - body.halfWidth - padding,
    y: protectedField.y - body.below - padding,
    width: protectedField.width + body.halfWidth * 2 + padding * 2,
    height: protectedField.height + body.above + body.below + padding * 2,
  }];
}
