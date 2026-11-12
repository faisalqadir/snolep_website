/*
 * leopard.js: a snow leopard made of dots that can stand, gallop and leap.
 *
 * A side-view skeleton of tapered limbs; every dot is pinned inside one limb, so the animal holds
 * together in any pose. pose() fills screen positions for a ground point, a heading and a stride
 * phase. Units are body lengths; forward is +x, up is +y.
 */
const TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;

// the limbs for one pose, as [x0, y0, x1, y1, r0, r1]
function skeleton(ph, run, leap, out) {
  const s = Math.sin(TAU * ph);
  const flex = mix(run * s, 1, leap);                       // +1 stretched out, -1 gathered
  const go = Math.max(run, leap);
  const dist = 0.56 + 0.05 * flex;
  const hy = 0.44 - 0.03 * go + run * (1 - leap) * 0.03 * Math.cos(2 * TAU * ph);
  const hip = [-dist / 2, hy + 0.012 * flex], sh = [dist / 2, hy - 0.01 - 0.012 * flex], mid = [0, hy + 0.035 - 0.05 * flex];
  const nb = [sh[0] + 0.07, sh[1] + 0.055 - 0.02 * go], head = [nb[0] + 0.105, nb[1] + 0.06 - 0.04 * go], nose = [head[0] + 0.07, head[1] - 0.035];
  let n = 0;
  const seg = (a, b, r0, r1) => { const o = out[n++]; o[0] = a[0]; o[1] = a[1]; o[2] = b[0]; o[3] = b[1]; o[4] = r0; o[5] = r1; };
  const step = (a, ang, len) => [a[0] + Math.sin(ang) * len, a[1] - Math.cos(ang) * len];

  seg(hip, mid, 0.125, 0.132); seg(mid, sh, 0.132, 0.135);
  seg(sh, nb, 0.128, 0.112); seg(nb, head, 0.11, 0.098); seg(head, nose, 0.096, 0.062);
  seg([head[0] - 0.035, head[1] + 0.085], [head[0] - 0.045, head[1] + 0.1], 0.03, 0.027);   // ear

  for (let side = 0; side < 2; side++) {                    // near, then far (a little behind in the stride)
    const p = TAU * (ph - side * 0.09);
    // front leg: reaches forward as the body stretches, folds at the wrist while it swings through
    const a1 = mix(run * 0.95 * Math.sin(p), 1.15, leap);
    const a2 = mix(a1 - run * 1.15 * Math.max(0, Math.cos(p)), 1.0, leap);
    const fs = [sh[0] - 0.02 - side * 0.015, sh[1] - 0.045], fe = step(fs, a1, 0.165), fw = step(fe, a2, 0.165), fp = step(fw, a2 + 0.5, 0.05);
    seg(fs, fe, 0.072, 0.05); seg(fe, fw, 0.047, 0.038); seg(fw, fp, 0.042, 0.038);
    // hind leg: thigh, shin, hock; drives back as the body stretches
    const q = p + 0.5;
    const b1 = mix(0.2 - run * 0.95 * Math.sin(q), -0.95, leap);
    const b2 = mix(b1 - 0.55 - run * 0.75 * Math.max(0, -Math.cos(q)), -1.2, leap);
    const b3 = mix(b2 + 0.85 - run * 0.3 * Math.max(0, -Math.cos(q)), -0.75, leap);
    const hs = [hip[0] + 0.03 + side * 0.015, hip[1] - 0.03], hk = step(hs, b1, 0.17), ha = step(hk, b2, 0.17), hf = step(ha, b3, 0.115), ht = step(hf, b3 + 1.1, 0.04);
    seg(hs, hk, 0.105, 0.06); seg(hk, ha, 0.056, 0.038); seg(ha, hf, 0.037, 0.034); seg(hf, ht, 0.038, 0.034);
  }
  // tail: long and thick; hangs in a curve when standing, streams behind in a run
  let t = [hip[0] - 0.07, hip[1] + 0.03];
  for (let i = 0; i < 8; i++) {
    const stand = -0.75 + i * 0.2, away = 0.22 + 0.2 * Math.sin(TAU * ph - i * 0.55) * (1 - leap) - i * 0.015 + leap * 0.1;
    const ang = mix(stand, away, go), nx = [t[0] - Math.cos(ang) * 0.085, t[1] + Math.sin(ang) * 0.085];
    seg(t, nx, 0.056 - i * 0.0015, 0.055 - i * 0.0015);
    t = nx;
  }
  // keep the paws out of the ground
  let low = 1;
  for (let i = 0; i < n; i++) low = Math.min(low, out[i][1] - out[i][4], out[i][3] - out[i][5]);
  if (low < 0) for (let i = 0; i < n; i++) { out[i][1] -= low; out[i][3] -= low; }
  return n;
}

export function createLeopard(N, used) {
  const segs = Array.from({ length: 28 }, () => new Float32Array(6));
  const count = skeleton(0, 0, 0, segs);
  const far = (i) => i >= 13 && i < 20;
  const S = new Uint8Array(N), Uu = new Float32Array(N), Vv = new Float32Array(N), size = new Float32Array(N), hide = new Uint8Array(N), tone = new Uint8Array(N);
  // where a point sits inside limb i, or null
  const inside = (i, x, y) => {
    const g = segs[i], dx = g[2] - g[0], dy = g[3] - g[1], l2 = dx * dx + dy * dy, len = Math.sqrt(l2);
    const u = ((x - g[0]) * dx + (y - g[1]) * dy) / l2, uc = Math.min(1, Math.max(0, u)), r = mix(g[4], g[5], uc);
    const px = x - g[0] - dx * uc, py = y - g[1] - dy * uc;
    if (px * px + py * py > r * r) return null;
    return [u, (-(x - g[0]) * dy + (y - g[1]) * dx) / len / r];
  };
  // the coat: rosettes on the body and tail, solid spots on the head and legs
  const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const coat = (i, x, y) => {
    const cell = i < 2 || i >= 20 ? 0.105 : 0.07, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best = 9;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const sx = (cx + a + 0.2 + 0.6 * hash(cx + a, cy + b)) * cell, sy = (cy + b + 0.2 + 0.6 * hash(cy + b + 7, cx + a)) * cell;
      best = Math.min(best, Math.hypot(x - sx, y - sy));
    }
    if (i < 2 || i >= 20) return best > 0.017 && best < 0.036 ? 1 : 0;     // a ring
    return best < 0.02 ? 1 : 0;
  };
  // a fine hex grid over the standing animal: each point goes to the first limb that holds it, so
  // the dots sit evenly, like a halftone; the far legs get a pass of their own
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 21, 22, 23, 24, 25, 26, 27];
  const back = [13, 14, 15, 16, 17, 18, 19];
  const holds = (set, x, y) => set.some((i) => inside(i, x, y));
  const edge = (set, x, y, g) => { for (let a = 0; a < 6; a++) if (!holds(set, x + Math.cos(a * 1.0472) * g * 1.15, y + Math.sin(a * 1.0472) * g * 1.15)) return true; return false; };
  const fill = (g, write) => {
    let j = 0;
    for (let row = 0, y = -0.02; y < 0.8; y += g * 0.866, row++) for (let x = -1.2 + (row % 2) * g / 2; x < 0.75; x += g) {
      for (const i of order) {
        const at = inside(i, x, y);
        if (!at) continue;
        if (write) { S[j] = i; Uu[j] = at[0]; Vv[j] = at[1]; tone[j] = i === 27 || edge(order, x, y, g) ? 1 : coat(i, x, y); size[j] = tone[j] ? 1 : 1.2; }
        j++; break;
      }
      for (const i of back) {
        const at = inside(i, x + g / 2, y + g / 3);
        if (!at) continue;
        if (write) { S[j] = i; Uu[j] = at[0]; Vv[j] = at[1]; tone[j] = edge(back, x + g / 2, y + g / 3, g) ? 1 : 0; size[j] = tone[j] ? 0.8 : 1.2; }
        j++; break;
      }
    }
    return j;
  };
  let grid = 0.012;
  while (fill(grid, false) > Math.min(N, used)) grid *= 1.03;
  const j = fill(grid, true);
  for (let k = j; k < N; k++) { S[k] = S[k % j]; Uu[k] = Uu[k % j]; Vv[k] = Vv[k % j]; size[k] = 0; hide[k] = 1; }

  // gx, gy: the ground under the body, in pixels; (fx, fy): unit heading; L: body length in pixels
  function pose({ gx, gy, fx, fy, L, phase, run, leap }, X, Y) {
    const n = skeleton(phase, run, leap, segs);
    let ux = -fy, uy = fx;                                   // up: the normal that points up the screen
    if (uy > 0) { ux = -ux; uy = -uy; }
    for (let k = 0; k < N; k++) {
      const g = segs[S[k]], u = Uu[k];
      const dx = g[2] - g[0], dy = g[3] - g[1], len = Math.hypot(dx, dy) || 1, r = mix(g[4], g[5], Math.min(1, Math.max(0, u)));
      const x = g[0] + dx * u - dy / len * Vv[k] * r, y = g[1] + dy * u + dx / len * Vv[k] * r;
      X[k] = gx + L * (x * fx + y * ux); Y[k] = gy + L * (x * fy + y * uy);
    }
    return n;
  }
  return { pose, size, hide, tone, used: j, grid };
}
