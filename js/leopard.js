/*
 * leopard.js: the snow leopard as dots, played from frames of a drawn reference.
 *
 * js/leopard-frames.js holds every frame on one shared grid: each cell is empty, coat (a light dot
 * inside the silhouette) or ink (a dark dot sized by the drawing). pose() lays the grid on the
 * page at a ground point, turned to the slope, and blends two frames. Frame 0 stands, 1 to 6 are
 * the gallop, 1 is also the leap. The animal faces left.
 */
import { PITCH, COUNT, FRAMES, GX, GY, V } from './leopard-frames.js';

const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const STAND = 0, LEAP = 1, CYCLE = [1, 2, 3, 4, 5, 6];

export function createLeopard(N) {
  const gx = new Int8Array(bytes(GX).buffer), gy = new Int8Array(bytes(GY).buffer), v = bytes(V);
  const used = Math.min(N, COUNT);
  const size = new Float32Array(N), tone = new Uint8Array(N), hide = new Uint8Array(N);
  for (let k = used; k < N; k++) hide[k] = 1;
  const val = (f, k) => v[f * COUNT + k];
  const dotSize = (b) => (b >= 128 ? 0.45 + 0.55 * (b - 128) / 127 : b ? 0.62 : 0);

  // ground: where the paws touch, in px; angle: the slope; scale: px per drawing px;
  // a, b, t: blend frame a towards b
  function pose({ x, y, angle, scale, a, b = a, t = 0 }, X, Y) {
    const c = Math.cos(angle) * scale * PITCH, s = Math.sin(angle) * scale * PITCH;
    for (let k = 0; k < used; k++) {
      const lx = gx[k] + 0.5, ly = gy[k] - 0.5;
      X[k] = x + lx * c - ly * s; Y[k] = y + lx * s + ly * c;
      const va = val(a, k), vb = val(b, k), sa = dotSize(va), sb = dotSize(vb);
      size[k] = sa + (sb - sa) * t;
      tone[k] = (t < 0.5 ? va : vb) >= 128 ? 1 : 0;
    }
    for (let k = used; k < N; k++) { X[k] = x; Y[k] = y; }
    return scale * PITCH * 0.5;                     // the radius of a full-size dot
  }
  return { pose, size, tone, hide, used, frames: FRAMES };
}
