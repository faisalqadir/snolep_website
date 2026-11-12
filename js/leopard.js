/*
 * leopard.js: the snow leopard as dots, from frames of a drawn reference.
 *
 * js/leopard-frames.js holds the same COUNT dots in every pose, matched so dot k in one pose is
 * dot k in the next. pose() slides each dot between two poses, so the gallop moves smoothly
 * instead of flicking from frame to frame. Frame 0 stands, 1 to 6 are the gallop (1 is also the
 * leap). The animal faces left; (x, y) is the ground under the middle of its body.
 */
import { PITCH, COUNT, FRAMES, X as FX, Y as FY, V } from './leopard-frames.js';

const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const STAND = 0, LEAP = 1, CYCLE = [1, 2, 3, 4, 5, 6];

export function createLeopard(N) {
  const fx = new Int8Array(bytes(FX).buffer), fy = new Int8Array(bytes(FY).buffer), v = bytes(V);
  const used = Math.min(N, COUNT);
  const size = new Float32Array(N), tone = new Uint8Array(N), hide = new Uint8Array(N);
  for (let k = used; k < N; k++) hide[k] = 1;
  const dotSize = (b) => (b >= 128 ? 0.45 + 0.55 * (b - 128) / 127 : b ? 0.62 : 0);

  // a, b: the two poses; t: how far from a to b (eased here)
  function pose({ x, y, angle, scale, a, b = a, t = 0 }, X, Y) {
    const c = Math.cos(angle) * scale * PITCH, s = Math.sin(angle) * scale * PITCH;
    const e = t * t * (3 - 2 * t), A = a * COUNT, B = b * COUNT;
    for (let k = 0; k < used; k++) {
      const lx = fx[A + k] + (fx[B + k] - fx[A + k]) * e + 0.5, ly = fy[A + k] + (fy[B + k] - fy[A + k]) * e - 0.5;
      X[k] = x + lx * c - ly * s; Y[k] = y + lx * s + ly * c;
      const va = v[A + k], vb = v[B + k], sa = dotSize(va), sb = dotSize(vb);
      size[k] = sa + (sb - sa) * e;
      tone[k] = (e < 0.5 ? va : vb) >= 128 ? 1 : 0;
    }
    for (let k = used; k < N; k++) { X[k] = x; Y[k] = y; }
    return scale * PITCH * 0.5;                      // the radius of a full-size dot
  }
  return { pose, size, tone, hide, used, frames: FRAMES };
}
