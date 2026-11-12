/*
 * dots.js: one canvas of dots that gather into shapes and blow away as snow.
 *
 * Each form is a picture or a line of text, turned into dots and pinned to an element on the page.
 * The page says how present each form is (0 to 1) from the scroll; between forms the dots drift as
 * a light snowfall. Every dot's place is worked out from the scroll and the clock alone, so nothing
 * lags or overshoots however fast the page moves. No libraries.
 *
 *   import { createDots } from './js/dots.js';
 *   createDots({
 *     canvas, dark: ['.finale'],                 // dots turn light over these elements
 *     forms: [
 *       { el, image, crop: [x0, y0, x1, y1], presence: ({ rect, vh, t }) => [amount, dotScale] },
 *       { el, text: ['SNOLEP TECHNOLOGIES'], font: '800 100px Archivo', presence },
 *     ],
 *   });
 */
export function createDots(opts) {
  const canvas = opts.canvas;
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const colors = Object.assign({ ink: '#002735', accent: '#00a6a2', light: '#e9f7f4' }, opts.colors);
  const darkEls = (opts.dark || []).map((s) => document.querySelector(s)).filter(Boolean);
  const forms = opts.forms;
  const N = opts.count || (innerWidth < 700 ? 2400 : 4200);
  const R = opts.radius || 1.75;

  // what each dot is when it's snow
  const rnd = (() => { let s = 20241; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const U = new Float32Array(N), V = new Float32Array(N), PH = new Float32Array(N), FALL = new Float32Array(N);
  const WIND = new Float32Array(N), PAR = new Float32Array(N), SR = new Float32Array(N), SWX = new Float32Array(N), SWY = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    U[j] = rnd(); V[j] = rnd(); PH[j] = rnd() * 6.283;
    const flake = rnd() < 0.05;                    // the few that show as snow
    SR[j] = flake ? 0.9 + rnd() * 1.3 : 0;
    FALL[j] = flake ? 9 + rnd() * 22 : 0;
    WIND[j] = flake ? 5 + rnd() * 12 : 0;
    PAR[j] = flake ? 0.12 + rnd() * 0.3 : 0;
    SWX[j] = (rnd() - 0.35) * 150; SWY[j] = (rnd() - 0.6) * 110;
  }

  // ---- forms ---------------------------------------------------------------------------------
  function atkinson(tone, w, h, gain) {
    const v = new Float32Array(w * h);
    for (let i = 0; i < v.length; i++) v[i] = tone[i] < 0 ? 0 : tone[i] * gain;
    const on = [];
    const add = (x, y, e) => { if (x >= 0 && x < w && y < h && tone[y * w + x] >= 0) v[y * w + x] += e; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (tone[i] < 0) continue;
      const out = v[i] > 0.5 ? 1 : 0;
      if (out) on.push(i);
      const e = (v[i] - out) / 8;
      add(x + 1, y, e); add(x + 2, y, e); add(x - 1, y + 1, e); add(x, y + 1, e); add(x + 1, y + 1, e); add(x, y + 2, e);
    }
    return on;
  }
  function ditherExactly(tone, w, h, n) {
    let gain = 1, on = [];
    for (let i = 0; i < 12; i++) {
      on = atkinson(tone, w, h, gain);
      if (Math.abs(on.length - n) <= n * 0.03) break;
      gain = Math.min(5, Math.max(0.15, gain * Math.sqrt(n / Math.max(1, on.length))));
    }
    if (on.length > n) return on.sort((a, b) => tone[b] - tone[a]).slice(0, n);
    if (on.length < n) {
      const used = new Uint8Array(w * h);
      for (const i of on) used[i] = 1;
      const spare = [];
      for (let i = 0; i < w * h; i++) if (tone[i] >= 0 && !used[i]) spare.push(i);
      spare.sort((a, b) => tone[b] - tone[a]);
      return on.concat(spare.slice(0, n - on.length));
    }
    return on;
  }
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d', { willReadFrequently: true });

  function fromImage(f) {
    const img = f.image, c = f.crop || [0, 0, 1, 1];
    const sw = img.naturalWidth * (c[2] - c[0]), sh = img.naturalHeight * (c[3] - c[1]);
    const w = Math.round(Math.sqrt(N * 4.2 * sw / sh)), h = Math.round(w * sh / sw);
    scratch.width = w; scratch.height = h;
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(img, img.naturalWidth * c[0], img.naturalHeight * c[1], sw, sh, 0, 0, w, h);
    const px = sctx.getImageData(0, 0, w, h).data;
    const tone = new Float32Array(w * h), teal = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], a = px[i * 4 + 3];
      if (a < 128) { tone[i] = -1; continue; }
      const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      teal[i] = g - r > 70 && lum < 0.75 ? 1 : 0;
      tone[i] = Math.max(0.05, teal[i] ? 0.7 : 1 - lum);
    }
    const on = ditherExactly(tone, w, h, N);
    f.n = on.length;
    for (let j = 0; j < N; j++) {
      const i = on[j % on.length];
      f.x[j] = ((i % w) + 0.5) / w; f.y[j] = (Math.floor(i / w) + 0.5) / h;
      f.teal[j] = teal[i]; f.hide[j] = j >= on.length ? 1 : 0;
    }
    f.r = R; f.gw = w;
  }

  function fromText(f) {
    const box = f.el.getBoundingClientRect();
    const lines = typeof f.text === 'function' ? f.text(box.width) : f.text;
    sctx.font = f.font;
    const wide = Math.max(...lines.map((l) => sctx.measureText(l).width));
    const size = 100 * box.width / wide, lead = size * 0.86;
    const height = lead * lines.length - size * 0.12;
    f.el.style.height = `${Math.ceil(height)}px`;
    let pts = [], cell = 3;
    for (; cell < 14; cell += 0.25) {
      const w = Math.ceil(box.width / cell), h = Math.ceil(height / cell);
      scratch.width = w; scratch.height = h;
      sctx.font = f.font.replace('100px', `${size / cell}px`);
      sctx.textBaseline = 'alphabetic'; sctx.textAlign = 'left'; sctx.fillStyle = '#000';
      lines.forEach((l, i) => sctx.fillText(l, 0, (lead * i + size * 0.73) / cell));
      const px = sctx.getImageData(0, 0, w, h).data;
      pts = [];
      for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > 120) pts.push(i);
      if (pts.length <= N) { f.gw = w; f.gh = h; break; }
    }
    f.n = pts.length;
    for (let j = 0; j < N; j++) {
      const i = pts[j % Math.max(1, pts.length)] || 0;
      f.x[j] = ((i % f.gw) + 0.5) / f.gw; f.y[j] = (Math.floor(i / f.gw) + 0.5) / f.gh;
      f.teal[j] = 0; f.hide[j] = j >= pts.length ? 1 : 0;
    }
    f.r = Math.min(3.2, cell * 0.4);
  }

  function build() {
    for (const f of forms) {
      f.x = f.x || new Float32Array(N); f.y = f.y || new Float32Array(N);
      f.teal = f.teal || new Uint8Array(N); f.hide = f.hide || new Uint8Array(N); f.d = f.d || new Float32Array(N);
      if (f.rig) { f.ax = new Float32Array(N); f.ay = new Float32Array(N); f.size = f.rig.size; f.hide = f.rig.hide; f.n = f.rig.used; }
      else if (f.image) fromImage(f); else fromText(f);
      // the order they leave in: the windward side first, with some scatter
      for (let j = 0; j < N; j++) f.d[j] = f.rig ? (j * 0.6180339) % 1 : 0.55 * (1 - f.x[j]) + 0.45 * ((j * 0.6180339) % 1);
    }
  }

  // ---- the frame -----------------------------------------------------------------------------
  let vw = 0, vh = 0, dpr = 1, builtFor = 0;
  function size() {
    vw = innerWidth; vh = innerHeight; dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    if (vw !== builtFor) { builtFor = vw; build(); }
  }
  let mx = -999, my = -999, px = -999, py = -999;
  // scatter: what the pointer has knocked each dot off its place by, and how fast it's still going
  const OX = new Float32Array(N), OY = new Float32Array(N), VX = new Float32Array(N), VY = new Float32Array(N);
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { mx = e.clientX; my = e.clientY; } }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { mx = my = -999; });

  const paths = [null, null, null, null, null, null];
  const fills = [colors.ink, colors.accent, colors.light, 'rgba(0, 39, 53, .34)', 'rgba(233, 247, 244, .45)', '#ffffff'];
  const t0 = performance.now();
  let raf = 0;
  const state = { form: -1, amount: 0, n: N };
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const calm = still.matches;
    const t = (now - t0) / 1000, tt = calm ? 0 : t, sy = scrollY;
    const lx = px, ly = py;
    px = mx; py = my;
    const sweep = lx < -900 || px < -900 ? 0 : Math.min(60, Math.hypot(px - lx, py - ly));

    // every form that is present, in page order: each pulls the dots on from wherever the one
    // before left them, so a form can hand over to the next without passing through snow
    const act = [];
    for (const f of forms) {
      const r = f.el.getBoundingClientRect();
      const env = { rect: r, vh, vw, t, scrollY: sy, calm };
      const p = f.presence(env);
      const amount = calm ? (p[0] > 0.5 && !f.rig ? 1 : 0) : p[0];
      if (amount <= 0) continue;
      const scale = p[1] === undefined ? 1 : p[1];
      f._w = amount; f._rect = r;
      f._r = (f.rig ? f.place(env, f.ax, f.ay) : f.image ? Math.min(f.r, r.width / f.gw * 0.54) : f.r) * scale;
      act.push(f);
    }
    state.form = act.length ? forms.indexOf(act[act.length - 1]) : -1;
    state.amount = act.length ? act[act.length - 1]._w : 0;
    const darks = darkEls.map((el) => el.getBoundingClientRect());
    for (let b = 0; b < 6; b++) paths[b] = new Path2D();
    const S = 1.1, spanY = vh + 40, spanX = vw + 40;

    for (let j = 0; j < N; j++) {
      let x, y, r = 0, top = 0, teal = 0, coat = -1;
      if (SR[j]) {
        x = ((U[j] * spanX + tt * WIND[j] + Math.sin(tt * 0.5 + PH[j]) * 14) % spanX) - 20;
        y = ((((V[j] * spanY + tt * FALL[j] - sy * PAR[j]) % spanY) + spanY) % spanY) - 20;
        r = calm ? 0 : SR[j];
      } else {
        x = U[j] * vw + Math.sin(tt * 0.3 + PH[j]) * 30; y = V[j] * vh + Math.cos(tt * 0.25 + PH[j]) * 30;
      }
      for (let a = 0; a < act.length; a++) {
        const f = act[a], rect = f._rect;
        let ww = Math.min(1, Math.max(0, f._w * (1 + S) - f.d[j] * S));
        if (ww <= 0) continue;
        ww = ww * ww * (3 - 2 * ww);
        const arc = Math.sin(Math.PI * ww) * (a ? 0.45 : 1);
        const tx = f.rig ? f.ax[j] : rect.left + f.x[j] * rect.width, ty = f.rig ? f.ay[j] : rect.top + f.y[j] * rect.height;
        x += (tx - x) * ww + arc * SWX[j];
        y += (ty - y) * ww + arc * SWY[j];
        r += ((f.hide[j] ? 0 : f._r * (f.rig ? f.size[j] : 1)) - r) * ww;
        if (ww > 0.5) { teal = f.rig ? 0 : f.teal[j]; coat = f.rig ? f.rig.tone[j] : -1; }
        top = Math.max(top, ww);
      }
      if (top > 0) {
        // a passing pointer knocks dots flying in loose directions; they drift back on a soft spring
        const dx = x + OX[j] - px, dy = y + OY[j] - py, d2 = dx * dx + dy * dy;
        if (sweep > 0.5 && d2 < 4900) {
          const d = Math.sqrt(d2) || 1, turn = (((j * 0.7548) % 1) - 0.5) * 2.4, c = Math.cos(turn), sn = Math.sin(turn);
          const kick = (1 - d / 70) * (0.5 + ((j * 0.5698) % 1) * 1.6) * (1.2 + sweep * 0.22);
          VX[j] += (dx / d * c - dy / d * sn) * kick; VY[j] += (dx / d * sn + dy / d * c) * kick;
        }
        if (OX[j] || OY[j] || VX[j] || VY[j]) {
          VX[j] = (VX[j] - OX[j] * 0.012) * 0.93; VY[j] = (VY[j] - OY[j] * 0.012) * 0.93;
          OX[j] += VX[j]; OY[j] += VY[j];
          if (Math.abs(OX[j]) + Math.abs(OY[j]) + Math.abs(VX[j]) + Math.abs(VY[j]) < 0.05) OX[j] = OY[j] = VX[j] = VY[j] = 0;
          x += OX[j] * top; y += OY[j] * top;
        }
      } else if (OX[j] || OY[j]) OX[j] = OY[j] = VX[j] = VY[j] = 0;
      if (r < 0.2 || x < -6 || y < -6 || x > vw + 6 || y > vh + 6) continue;
      let bucket = teal;
      if (coat >= 0) bucket = coat ? 0 : 5; else
      if (!bucket) for (const d of darks) if (y >= d.top && y <= d.bottom && x >= d.left && x <= d.right) { bucket = 2; break; }
      if (top < 0.5 && bucket !== 1 && coat < 0) bucket = bucket ? 4 : 3;
      paths[bucket].moveTo(x + r, y); paths[bucket].arc(x, y, r, 0, 6.2832);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    for (const b of [3, 4, 5, 0, 1, 2]) { ctx.fillStyle = fills[b]; ctx.fill(paths[b]); }
  }

  let resizeT = 0;
  addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(size, 120); });
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) raf = requestAnimationFrame(frame);
  });
  size();
  raf = requestAnimationFrame(frame);
  return { state, forms, rebuild: () => { builtFor = 0; size(); } };
}
