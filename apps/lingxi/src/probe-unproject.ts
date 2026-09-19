// Screen->world unprojection probe - dev-only, NOT a build input.
//
// The bug: screenToWorld ends with
//     raycaster.ray.intersectPlane(groundPlane, placement) ?? placement.set(0, planeY, 0)
// and three.js Ray.intersectPlane returns null when the hit is BEHIND the ray origin (t < 0),
// not only when the ray is parallel to the plane. For an orthographic camera the ray origin sits
// on the near plane, so at extreme screen positions - the bottom of the screen at a low camera
// elevation - the ground intersection falls behind it and the function silently returns the
// WORLD ORIGIN. The world origin draws at the centre of the screen, so the cat vanishes from the
// bottom edge and reappears in the middle ("在屏幕最下方的时候闪回到屏幕中间位置").
//
// It is invisible from outside the renderer: the life engine's position is still correct, and
// /perception reports it correctly. Only the drawing jumps. That is why polling the bridge for
// position jumps found nothing.
//
// Healthy output: "fallbacks" is 0 for every camera preset at every sampled pixel.
//
// The probe round-trips the SHIPPED screenToWorld - unproject to the ground plane, project back
// through the camera, check it lands where it started. Testing the raycast call directly would
// have stopped testing anything the moment screenToWorld was rewritten not to use it.
import { createThreeRenderer, CAMERA_PRESETS } from './renderer.ts';

const WIDTH = 1470;
const HEIGHT = 956;

const stage = document.createElement('div');
stage.style.cssText = `position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px;visibility:hidden`;
document.body.appendChild(stage);

const renderer = createThreeRenderer();
renderer.mount(stage);
renderer.resize(WIDTH, HEIGHT);

const lines: string[] = [];
lines.push('Unprojecting every part of the screen onto the ground plane.');
lines.push('A "fallback" is a pixel that does NOT round-trip: unproject to the ground and project');
lines.push('back, and you land somewhere else. That is the cat drawn in the wrong place.');
lines.push('');

for (const preset of CAMERA_PRESETS) {
  renderer.setCameraPreset?.(preset.id);
  for (let i = 0; i < 3; i += 1) {
    renderer.render({ state: 'idle', position: { x: WIDTH / 2, y: HEIGHT / 2 }, facing: 1 }, 1, null);
  }
  let fallbacks = 0;
  let worstY = -1;
  const probe = (renderer as unknown as { probeUnproject?: (x: number, y: number) => boolean }).probeUnproject;
  if (!probe) { lines.push(`${preset.id}: probeUnproject() unavailable`); continue; }
  for (let sy = 0; sy <= HEIGHT; sy += 8) {
    for (let sx = 0; sx <= WIDTH; sx += 24) {
      if (!probe(sx, sy)) {
        fallbacks += 1;
        if (worstY < 0) worstY = sy;
      }
    }
  }
  lines.push(
    `${preset.id.padEnd(14)} elevation ${String(preset.elevationDeg).padStart(4)}deg   ` +
    `fallbacks ${String(fallbacks).padStart(6)}` +
    (fallbacks ? `   first at screen y=${worstY} (screen is ${HEIGHT} tall)` : '   clean'),
  );
}
document.getElementById('out')!.textContent = lines.join('\n');
