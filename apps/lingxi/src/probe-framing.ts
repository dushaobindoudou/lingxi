// Screen-edge framing probe - dev-only, NOT a build input. Open /probe-framing.html.
//
// The bug this exists for: the life engine keeps the cat a fixed distance from every screen
// edge, but the point it steers is the cat's FEET. The body is drawn above that point and
// almost nothing below it, so one number cannot frame all four edges - 24px from the top puts
// the whole cat off the screen while 24px from the bottom hides none of it. Reported as
// "太靠上边缘了...上下会被盖着太多，左右两侧只盖住一半身体我觉得是对的".
//
// So this measures, through the REAL renderer and the REAL camera, how much of the cat each
// edge actually clips once main.ts's syncMargins() has done its work.
//
// Healthy output: "hidden top" and "hidden bottom" are 0% on every row - none of the cat is ever
// clipped by the top or bottom edge - while "hidden sides" stays at the ~32% that was already
// approved. If top ever climbs toward 100% the anchor asymmetry is back and the cat is parking
// its head off the screen.
//
// The sides are treated differently ON PURPOSE. The cat is about three times taller than it is
// wide, so the same fraction that costs 43px of flank at the side costs 124px of skull at the
// top, and the face is what the whole app is for.
import { createThreeRenderer, CAMERA_PRESETS } from './renderer.ts';

const WIDTH = 1470;
const HEIGHT = 956;
const EDGE_MARGIN = 24; // must match main.ts

const stage = document.createElement('div');
stage.style.cssText = `position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px;visibility:hidden`;
document.body.appendChild(stage);

const renderer = createThreeRenderer();
renderer.mount(stage);
renderer.resize(WIDTH, HEIGHT);

/** The same derivation main.ts performs, kept here so the probe measures the shipped rule. */
function marginsFor(extent: { above: number; below: number; halfWidth: number }) {
  return { left: EDGE_MARGIN, right: EDGE_MARGIN, top: extent.above, bottom: extent.below };
}

const lines: string[] = [];
lines.push('Cat extent from its anchor (feet), and what each edge then clips.');
lines.push('');

for (const preset of CAMERA_PRESETS) {
  const camera = preset.id;
  renderer.setCameraPreset?.(camera);
  for (const scale of [0.7, 1.0, 1.4]) {
    renderer.setScale(scale);
    // Two frames: the first eases the camera toward the new preset, the second lets it land.
    for (let i = 0; i < 2; i += 1) {
      renderer.render({ state: 'idle', position: { x: WIDTH / 2, y: HEIGHT / 2 }, facing: 1 }, 1, null);
    }

    const extent = renderer.screenExtent?.();
    if (!extent) { lines.push(`${camera} @${scale}: screenExtent() unavailable`); continue; }
    const m = marginsFor(extent);
    const height = extent.above + extent.below;
    // What share of the body is off-screen when the cat is pressed against each edge.
    const hiddenTop = (extent.above - m.top) / height;
    const hiddenBottom = (extent.below - m.bottom) / height;
    const hiddenSide = (extent.halfWidth - EDGE_MARGIN) / (extent.halfWidth * 2);
    const pct = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(4);
    lines.push(
      `${camera.padEnd(14)} scale ${scale.toFixed(1)}  ` +
      `body ${height.toFixed(0)}px tall (${extent.above.toFixed(0)} up / ${extent.below.toFixed(0)} down), ` +
      `${(extent.halfWidth * 2).toFixed(0)}px wide`,
    );
    lines.push(
      `${''.padEnd(14)}   margins  top ${m.top.toFixed(0).padStart(4)}  bottom ${m.bottom.toFixed(0).padStart(4)}  sides ${EDGE_MARGIN}` +
      `   hidden  top ${pct(hiddenTop)}  bottom ${pct(hiddenBottom)}  sides ${pct(hiddenSide)}`,
    );
  }
  lines.push('');
}

document.getElementById('out')!.textContent = lines.join('\n');
