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
// There are two boxes, and this prints both.
//
//   ROAM  where the cat sends itself when nothing is happening. Healthy: "hidden top" and
//         "hidden bottom" are 0% on every row - a pet you cannot see is not a pet - while
//         "hidden sides" stays at the ~32% that was already approved. If top ever climbs
//         toward 100% the anchor asymmetry is back and the cat is parking its head off-screen.
//   LIMIT how far anything may push it - a drag, a toy, a performance charging the camera.
//         Healthy: 50% on all four edges. This is the tier that lets extreme moments actually
//         look extreme.
//
// Sides and vertical are treated differently in the ROAM box ON PURPOSE. The cat is about three
// times taller than it is wide, so the same fraction that costs 43px of flank at the side costs
// 124px of skull at the top, and the face is what the whole app is for.
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
  const height = extent.above + extent.below;
  return {
    roam: { left: EDGE_MARGIN, right: EDGE_MARGIN, top: extent.above, bottom: extent.below },
    limit: { left: 0, right: 0, top: extent.above - height * 0.5, bottom: extent.below - height * 0.5 },
  };
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
    const { roam, limit } = marginsFor(extent);
    const height = extent.above + extent.below;
    const pct = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(4);
    // What share of the body is off-screen when the cat is pressed against each edge.
    const hidden = (box: { top: number; bottom: number; left: number }) => ({
      top: (extent.above - box.top) / height,
      bottom: (extent.below - box.bottom) / height,
      sides: (extent.halfWidth - box.left) / (extent.halfWidth * 2),
    });
    lines.push(
      `${camera.padEnd(14)} scale ${scale.toFixed(1)}  ` +
      `body ${height.toFixed(0)}px tall (${extent.above.toFixed(0)} up / ${extent.below.toFixed(0)} down), ` +
      `${(extent.halfWidth * 2).toFixed(0)}px wide`,
    );
    for (const [name, box] of [['roam ', roam], ['limit', limit]] as const) {
      const h = hidden(box);
      lines.push(
        `${''.padEnd(14)}   ${name}  top ${box.top.toFixed(0).padStart(5)}  bottom ${box.bottom.toFixed(0).padStart(5)}  sides ${box.left.toFixed(0).padStart(3)}` +
        `   hidden  top ${pct(h.top)}  bottom ${pct(h.bottom)}  sides ${pct(h.sides)}`,
      );
    }
  }
  lines.push('');
}

document.getElementById('out')!.textContent = lines.join('\n');
