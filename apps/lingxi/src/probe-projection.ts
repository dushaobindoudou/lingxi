// Projection probe - dev-only. Does a logical position actually land where we say it does?
//
// The renderer places things by multiplying a logical pixel offset by worldPerPixelX/Z. That is
// a DIFFERENTIAL relationship (how much world travel per pixel of screen travel) and it is
// correct as one. What it does not establish is the ORIGIN: whether the ground point we call
// (x, y) projects to screen (x, y), or to somewhere offset from it. Anything with volume hides
// the difference; a small object meant to sit exactly on the pointer does not.
import * as THREE from 'three';

const WIDTH = 1470;
const HEIGHT = 863;
const u = 2.6 / Math.max(WIDTH, HEIGHT);
const lines: string[] = [];

for (const [name, elevationDeg, lookAtY] of [
  ['look-up', -11, 0.5],
  ['eye-level', 9, 0.42],
  ['game', 24, 0.4],
  ['overhead', 60, 0.32],
] as [string, number, number][]) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 200);
  const e = THREE.MathUtils.degToRad(elevationDeg);
  camera.position.set(0, lookAtY + Math.sin(e) * 6, Math.cos(e) * 6);
  camera.lookAt(0, lookAtY, 0);
  camera.updateMatrixWorld(true);
  const camForward = new THREE.Vector3(0, lookAtY, 0).sub(camera.position).normalize();
  const groundRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
  const groundUp = new THREE.Vector3().crossVectors(groundRight, camForward);
  const halfW = WIDTH * u;
  const halfH = HEIGHT * u;
  camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  const worldPerPixelX = halfW / (WIDTH / 2) / groundRight.x;
  const worldPerPixelZ = -(halfH / (HEIGHT / 2)) / groundUp.z;

  // Where does the ground point the renderer would use for logical (x, y) actually land?
  const check = (lx: number, ly: number, height: number) => {
    const p = new THREE.Vector3((lx - WIDTH / 2) * worldPerPixelX, height, (ly - HEIGHT / 2) * worldPerPixelZ);
    p.project(camera);
    return { x: (p.x * 0.5 + 0.5) * WIDTH, y: (-p.y * 0.5 + 0.5) * HEIGHT };
  };
  const centre = check(WIDTH / 2, HEIGHT / 2, 0);
  const ball = check(WIDTH / 2, HEIGHT / 2, 2.0 * 0.055 * 0.5); // yarn radius at 0.5x scale
  lines.push(
    `${name.padEnd(10)} ground point for screen-centre lands at y=${centre.y.toFixed(1)} ` +
      `(off by ${(centre.y - HEIGHT / 2).toFixed(1)}px)   yarn-ball centre lands at y=${ball.y.toFixed(1)} ` +
      `(off by ${(ball.y - HEIGHT / 2).toFixed(1)}px)`,
  );
}
document.getElementById('out')!.textContent = lines.join('\n');
