/*!
 * dot-story.js
 * One field of dots that tells a story as the page scrolls. The same dots become, in turn:
 *   - optionally a picture first (a logo's mascot, say): the dots dither it in place, so the picture
 *     can dissolve into them before they leave for the character;
 *   - an animated 3D character: every dot is pinned to a point on a rigged GLB's surface (picked by
 *     Atkinson-dithering a lit render), so the figure holds together as it runs, leaps and turns,
 *     with the same gait, scrubbed clips and stillness as scroll-3d-hero's animated models;
 *   - sand: the character dives into an hourglass through the top and crumbles into sand, which
 *     runs through the neck while more is still pouring in, and comes back out of the bottom;
 *   - a dotted brand wordmark at the bottom of the page.
 * The pointer scatters the dots in every form, and they spring back.
 *
 * Needs the import map for "three" / "three/addons/" and scroll-3d-hero.js next to this file.
 *
 *   import { createDotStory } from './dot-story.js';
 *   createDotStory({ canvas: '#dots', image: {...}, character: {...}, hourglass: {...}, logo: {...}, keyframes: [...] });
 *
 * Keyframes interpolate per property between the keyframes that set it:
 *   at        progress 0..1 of the whole page, or a selector (that element's top at the viewport top);
 *             `after` adds screens, e.g. { at: '#story', after: 0.5 }
 *   x, y      character centre in viewport units (-1 left/bottom, 1 right/top), or `anchor: selector`
 *             (x and y then offset it). Between two keyframes on the same element the character rides
 *             along with it; heading for one from elsewhere, it aims where the element will be.
 *             `align: 'bottom'` stands it on the anchor, 'top' hangs it underneath, and 'pour' or
 *             'emerge' send it through the anchor head first, `pour` / `emerge` lengths past it
 *   size      character length as a fraction of the viewport's shorter side
 *   pitch     nose up (+) / down (-) in degrees, whichever way it faces
 *   face      1 (right) or -1 (left) holds the way it faces from this keyframe on, 0 hands it back
 *             to its motion; e.g. to come out of the hourglass already facing where it goes next
 *   clip, clipTime   scrub an animation clip with the scroll between two keyframes (in cycles)
 *   form      'image' | 'character' | 'logo': between two keyframes with different forms the dots
 *             move across one by one
 *   reveal    0..1, how visible the dots are while they form the image (default 1); the image
 *             element gets --dots-reveal to fade itself out against, e.g.
 *             opacity: calc(1 - var(--dots-reveal, 0))
 *   pour      how far the character has gone into the hourglass, in its own lengths along the dive:
 *             below 0 it is still above the inlet, 1 is all the way in; dots crumble into sand as
 *             they pass the inlet and land while it travels `hourglass.crumble` further
 *   drain     0..1, how much of the sand has run through the neck
 *   emerge    how far the character has come back out of the bottom, in lengths (dots set off from
 *             the sand a little before their place reaches the opening)
 *   ease      'linear', 'easeIn', 'easeOut', 'easeInOut' (default) or 'spline': a smooth curve that
 *             carries its speed through the keyframes instead of stopping at each one
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAnimator, normalizeObject } from './scroll-3d-hero.js';

const DEG = Math.PI / 180;
const NUM_KEYS = ['x', 'y', 'size', 'pitch', 'pour', 'drain', 'emerge', 'reveal'];
const NUM_DEFAULTS = { x: 0, y: 0, size: 0.3, pitch: 0, pour: 0, drain: 0, emerge: 0, reveal: 1 };

// what a dot is doing: part of the character, crumbling into the top bulb, sand in the top bulb,
// falling through the neck, sand in the bottom bulb, coming out of the bottom, part of the logo,
// part of the image, on its way between the image and the character
const BODY = 0, FALL = 1, TOP = 2, NECK = 3, BOTTOM = 4, EXIT = 5, LOGO = 6, IMAGE = 7, MORPH = 8;
// changes of state where the dot's target moves on without a jump, so the dot keeps following it
const SMOOTH = new Set([[BODY, FALL], [FALL, TOP], [TOP, NECK], [NECK, BOTTOM], [BOTTOM, EXIT], [EXIT, BODY], [IMAGE, MORPH], [MORPH, BODY]].flatMap(([a, b]) => [a * 16 + b, b * 16 + a]));

const EASE = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - (1 - t) ** 3,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};
const smoothstep = (t) => t * t * (3 - 2 * t);

const DEFAULTS = {
  canvas: '#dots', // a full-viewport canvas (position: fixed); its CSS `color` is the dot colour
  image: null, // { anchor: '#mascot' (an <img>), contrast, flip }: the picture the dots start as
  character: null, // { url | buffer, animation: { idle, walk, run, still, face, gait }, rotate, tilt }
  hourglass: null, // { anchor: '#hourglass', panel: '#panel', dive: -70 (match the pitch it pours in at), crumble: 0.3 }
  inverse: null, // selector for dark areas where dots use --panel-dots (the hourglass panel always does)
  logo: null, // { anchor: '#logo', text: 'ACME', fontFamily, fontWeight, fontStretch, ... }
  keyframes: [],
  responsive: {}, // { '(max-width: 767px)': { keyframes: [...] } }
  gap: 4, // starting dot spacing for the sand, in CSS px (it adjusts so each bulb holds every dot)
  contrast: 1.9, // tone stretch before dithering the character: higher reads more 3D, lower flatter
  particles: 2400, // pool size when there's no logo (with a logo, the pool matches its dot count)
  damping: 8, // how quickly the story catches up with the scrollbar
  maxLag: 0.12, // but it never trails it by more than this (in screens), so it keeps in step with the page on a fast flick
  pointer: { radius: 64, force: 5 },
  debug: false, // or ?dots-debug in the URL
};

export function createDotStory(userOptions = {}) {
  const base = { ...DEFAULTS, ...userOptions, pointer: { ...DEFAULTS.pointer, ...(userOptions.pointer || {}) } };
  const canvas = typeof base.canvas === 'string' ? document.querySelector(base.canvas) : base.canvas;
  if (!canvas) throw new Error(`[dot-story] canvas "${base.canvas}" not found`);
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const debug = base.debug || new URLSearchParams(location.search).has('dots-debug');
  const sprites = { ink: document.createElement('canvas'), panel: document.createElement('canvas') };
  const pointer = { x: 0, y: 0, until: 0 };

  let opts = base;
  let frames = [];
  let tracks = {};
  let vw = 1, vh = 1, dpr = 1, range = 1;
  let target = 0, smooth = 0, lastP = 0, lastTime = 0, rafId = 0, destroyed = false, ready = false, lastScrollY = -1;
  let N = 0, px, py, vx, vy, ease, fric, spread, jit, pos, byPos, wordOrder, state, ptx, pty;
  let revealNow = 1;
  let morphNow = null;
  let dotR = 1.3, spriteR = 0, colors = { ink: '#222', panel: '#eee' };
  let debugEl = null;
  let inverseAreas = [];

  /* ---------- keyframes ---------- */

  function computeOptions() {
    let o = base;
    for (const [q, over] of Object.entries(base.responsive || {})) if (matchMedia(q).matches) o = { ...o, ...over };
    return o;
  }

  function resolveAt(kf, index, count) {
    let at = kf.at ?? index / Math.max(1, count - 1);
    if (typeof at === 'string') {
      const el = document.querySelector(at);
      if (!el) {
        console.warn(`[dot-story] keyframe "at" target "${at}" not found`);
        at = 0;
      } else {
        at = (el.getBoundingClientRect().top + window.scrollY + (kf.after || 0) * vh) / range;
      }
    } else if (kf.after) {
      at += (kf.after * vh) / range;
    }
    return Math.min(1, Math.max(0, at));
  }

  function buildFrames() {
    const list = opts.keyframes || [];
    frames = list
      .map((kf, index) => {
        const f = { index, at: resolveAt(kf, index, list.length), ease: EASE[kf.ease] || (typeof kf.ease === 'function' ? kf.ease : EASE.easeInOut), spline: kf.ease === 'spline', v: {} };
        for (const k of NUM_KEYS) if (typeof kf[k] === 'number') f.v[k] = kf[k];
        if (kf.anchor) {
          f.anchor = document.querySelector(kf.anchor);
          if (!f.anchor) console.warn(`[dot-story] anchor "${kf.anchor}" not found`);
          f.ox = kf.x || 0;
          f.oy = kf.y || 0;
          f.align = kf.align || null;
        }
        if (typeof kf.clipTime === 'number') f.clipTime = kf.clipTime;
        if (kf.clip) f.clip = kf.clip;
        if (kf.form) f.form = kf.form;
        if (kf.face === 1 || kf.face === -1 || kf.face === 0) f.face = kf.face;
        return f;
      })
      .filter((f) => !f.anchor || f.anchor.isConnected)
      .sort((a, b) => a.at - b.at || a.index - b.index);
    // Where each anchor will be when the page reaches its keyframe. Heading for an element from
    // somewhere else aims there, rather than chasing the element while it's still scrolling.
    const anchored = frames.filter((f) => f.anchor);
    if (anchored.length) {
      const y0 = window.scrollY;
      for (const f of anchored) {
        window.scrollTo({ top: f.at * range, behavior: 'instant' });
        const r = f.anchor.getBoundingClientRect();
        f.fx = r.left + r.width / 2;
        f.fy = r.top + r.height / 2;
      }
      window.scrollTo({ top: y0, behavior: 'instant' });
    }
    tracks = {};
    for (const k of NUM_KEYS) {
      tracks[k] = frames.filter((f) => f.v[k] !== undefined || (f.anchor && (k === 'x' || k === 'y')));
    }
    tracks.clip = frames.filter((f) => f.clipTime !== undefined);
    tracks.form = frames.filter((f) => f.form);
    tracks.face = frames.filter((f) => f.face !== undefined);
  }

  // A keyframe's value. An anchored one uses the element live, or where it will be at that keyframe;
  // `p` is the progress its pour or emerge is read at.
  function valueOf(f, k, live, p) {
    if (!(f.anchor && (k === 'x' || k === 'y'))) return f.v[k];
    let ax = f.fx;
    let ay = f.fy;
    if (live || ax === undefined) {
      const r = f.anchor.getBoundingClientRect();
      ax = r.left + r.width / 2;
      ay = r.top + r.height / 2;
    }
    const c = character;
    const through = f.align === 'pour' || f.align === 'emerge';
    if (through && c.fit) {
      // passing through head first, along its own length (so a slanted dive goes in at a slant): its
      // leading point is pour (or emerge) lengths past the anchor. Once the page has reached this
      // keyframe its body follows the flow its dots follow (which can lag a fast scroll); heading
      // towards it, it aims for the keyframe's own value.
      const amount = flowNow[f.align] !== null && (live || lastP >= f.at) ? flowNow[f.align] : sample(f.align, p);
      const along = amount * c.fit.extent;
      if (k === 'x') return ((ax - c.fit.leadX + along * c.fit.ux) / vw) * 2 - 1 + f.ox;
      return 1 - ((ay - c.fit.lead + along * c.fit.uy) / vh) * 2 + f.oy;
    }
    if (k === 'x') {
      const off = f.align && c.box ? c.box.cx : 0;
      return ((ax - off) / vw) * 2 - 1 + f.ox;
    }
    let edge = 0;
    if (f.align && c.box) {
      edge = f.align === 'bottom' ? c.box.maxY : f.align === 'top' ? c.box.minY : (c.box.minY + c.box.maxY) / 2;
    }
    return 1 - ((ay - edge) / vh) * 2 + f.oy;
  }

  function sample(k, p) {
    const list = tracks[k];
    if (!list || !list.length) return NUM_DEFAULTS[k];
    if (p <= list[0].at) return valueOf(list[0], k, true, p);
    for (let i = 1; i < list.length; i++) if (p <= list[i].at) return segment(list, i, k, p);
    return valueOf(list[list.length - 1], k, true, p);
  }

  // the value between keyframes i-1 and i
  function segment(list, i, k, p) {
    const a = list[i - 1];
    const b = list[i];
    const t = b.at - a.at > 1e-6 ? (p - a.at) / (b.at - a.at) : 1;
    // both on the same element: ride along with it
    const same = !!a.anchor && a.anchor === b.anchor;
    const va = valueOf(a, k, same, same ? p : a.at);
    const vb = valueOf(b, k, same, same ? p : b.at);
    if (!b.spline) return va + (vb - va) * b.ease(t);
    // a cubic through the keyframes that keeps its speed across them (no stop at each one)
    const h = b.at - a.at;
    const ma = slope(list, i - 1, k) * h;
    const mb = slope(list, i, k) * h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * va + (t3 - 2 * t2 + t) * ma + (3 * t2 - 2 * t3) * vb + (t3 - t2) * mb;
  }

  // Speed at keyframe j, for spline segments: Catmull-Rom between two splines; next to any other kind
  // of segment, that segment's own speed at the joint, so the motion carries straight on into it (an
  // eased segment starts and ends at rest); zero at the ends.
  function slope(list, j, k) {
    const f = list[j];
    const prev = list[j - 1];
    const next = list[j + 1];
    const inSpline = !!prev && f.spline;
    const outSpline = !!next && next.spline;
    if (inSpline && outSpline) {
      return (valueOf(next, k, false, next.at) - valueOf(prev, k, false, prev.at)) / Math.max(1e-6, next.at - prev.at);
    }
    const eps = 1e-4;
    if (inSpline && next) return (segment(list, j + 1, k, f.at + eps) - segment(list, j + 1, k, f.at)) / eps;
    if (outSpline && prev) return (segment(list, j, k, f.at) - segment(list, j, k, f.at - eps)) / eps;
    return 0;
  }

  function sampleClip(p) {
    const list = tracks.clip;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (p >= a.at && p <= b.at && a.clip && a.clip === b.clip) {
        const t = b.at - a.at > 1e-6 ? (p - a.at) / (b.at - a.at) : 1;
        return { clip: a.clip, cycles: a.clipTime + (b.clipTime - a.clipTime) * b.ease(t) };
      }
    }
    return null;
  }

  // what the dots form at p: form `a`, moving over to form `b` by `blend` (0..1)
  function sampleForm(p) {
    const list = tracks.form;
    if (!list.length) return { a: 'character', b: 'character', blend: 0 };
    if (p <= list[0].at) return { a: list[0].form, b: list[0].form, blend: 0 };
    for (let i = 1; i < list.length; i++) {
      const b = list[i];
      if (p <= b.at) {
        const a = list[i - 1];
        const t = b.at - a.at > 1e-6 ? (p - a.at) / (b.at - a.at) : 1;
        return { a: a.form, b: b.form, blend: a.form === b.form ? 0 : b.ease(t) };
      }
    }
    const last = list[list.length - 1].form;
    return { a: last, b: last, blend: 0 };
  }

  /* ---------- the character: dots pinned to a 3D model ---------- */

  const character = {
    renderer: null, scene: null, camera: null, rt: null, buf: null, holder: null,
    yawGroup: null, tiltGroup: null, pitchGroup: null, anim: null, meshes: [],
    // each dot's pin: mesh, triangle corners and barycentric weights
    bound: 0, bm: null, ba: null, bb: null, bc: null, bu: null, bv: null, bw: null,
    lx: new Float32Array(0), ly: new Float32Array(0), cx: 0, cy: 0, box: null, fit: null,
    // each dot's depth along the dive (0 = the leading point, 1 = the trailing one), in pour order,
    // and the character's depth in lengths
    depth: new Float32Array(0), depthExtent: 1,
    stamp: 0, posed: false, speed: 0, vx: 0, dir: 0, yaw: 0, snap: true, moved: false,
  };

  async function loadCharacter(src) {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: false });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    // lit like a product shot, so the dithering picks up its shading and markings
    scene.add(new THREE.HemisphereLight(0xffffff, 0x202020, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(-1.4, 2.4, 2.2);
    scene.add(key);
    // an orthographic side view, in units of the character's length
    const camera = new THREE.OrthographicCamera(-0.8, 0.8, 0.6, -0.6, -10, 10);
    camera.position.set(0, 0, 5);
    const loader = new GLTFLoader();
    const gltf = src.buffer ? await loader.parseAsync(src.buffer, '') : await loader.loadAsync(src.url);
    const object = gltf.scene;
    const meshes = [];
    object.traverse((n) => {
      if (n.isSkinnedMesh) n.frustumCulled = false;
      if (n.isMesh && n.visible) {
        const count = n.geometry.attributes.position.count;
        meshes.push({
          mesh: n,
          skinned: !!n.isSkinnedMesh,
          morph: !!(n.morphTargetInfluences && n.geometry.morphAttributes.position),
          xyz: new Float32Array(count * 3),
          stamp: new Int32Array(count).fill(-1),
          bones: n.isSkinnedMesh ? new Float32Array(n.skeleton.bones.length * 16) : null,
        });
      }
    });
    const holder = normalizeObject(object, src.rotate);
    const yawGroup = new THREE.Group();
    const tiltGroup = new THREE.Group();
    const pitchGroup = new THREE.Group();
    yawGroup.add(holder);
    tiltGroup.add(yawGroup);
    pitchGroup.add(tiltGroup);
    tiltGroup.rotation.x = (src.tilt ?? 8) * DEG; // a little of its back shows, as in the 3D version
    scene.add(pitchGroup);
    Object.assign(character, { renderer, scene, camera, holder, yawGroup, tiltGroup, pitchGroup, meshes });
    if (src.animation && gltf.animations.length) character.anim = createAnimator(object, gltf.animations, src.animation);
  }

  function faceConfig() {
    const conf = character.anim ? character.anim.conf : {};
    return { moving: 90, idle: 75, start: 1, ...(conf.face && conf.face !== true ? conf.face : {}) };
  }

  function renderCharacter(w, h) {
    const c = character;
    if (!c.rt || c.rt.width !== w || c.rt.height !== h) {
      c.rt?.dispose();
      c.rt = new THREE.WebGLRenderTarget(w, h);
      c.buf = new Uint8Array(w * h * 4);
    }
    c.renderer.setRenderTarget(c.rt);
    c.renderer.clear();
    c.renderer.render(c.scene, c.camera);
    c.renderer.readRenderTargetPixels(c.rt, 0, 0, w, h, c.buf);
    c.renderer.setRenderTarget(null);
  }

  // darkness per covered pixel, stretched around its average so light and shadow (the 3D form)
  // survive the dithering; a floor keeps highlights from vanishing, so the outline still reads
  function toneMap(w, h) {
    const buf = character.buf;
    const tone = new Float32Array(w * h);
    let mean = 0;
    let covered = 0;
    for (let i = 0; i < w * h; i++) {
      if (buf[i * 4 + 3] < 128) {
        tone[i] = -1;
        continue;
      }
      const lum = Math.pow((buf[i * 4] * 0.299 + buf[i * 4 + 1] * 0.587 + buf[i * 4 + 2] * 0.114) / 255, 1 / 2.2);
      tone[i] = 1 - lum;
      mean += tone[i];
      covered++;
    }
    mean /= Math.max(1, covered);
    const k = opts.contrast ?? 1.9;
    for (let i = 0; i < w * h; i++) if (tone[i] >= 0) tone[i] = Math.min(1, Math.max(0.1, 0.5 + (tone[i] - mean) * k));
    return tone;
  }

  // Atkinson dithering, top row first: 6/8 of the error goes to six neighbours and 2/8 is dropped,
  // which keeps contrast crisp. Error only flows within the silhouette. GL rows run bottom-up.
  function atkinson(tone, w, h, gain) {
    const err = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) err[i] = tone[i] < 0 ? -1 : Math.min(1, tone[i] * gain);
    const on = [];
    const add = (x, r, e) => {
      if (x < 0 || x >= w || r >= h) return;
      const j = (h - 1 - r) * w + x;
      if (err[j] > -0.5) err[j] += e;
    };
    for (let r = 0; r < h; r++) {
      for (let x = 0; x < w; x++) {
        const i = (h - 1 - r) * w + x;
        const v = err[i];
        if (v < -0.5) continue;
        const isOn = v >= 0.5;
        if (isOn) on.push(i);
        const e = (v - (isOn ? 1 : 0)) / 8;
        add(x + 1, r, e);
        add(x + 2, r, e);
        add(x - 1, r + 1, e);
        add(x, r + 1, e);
        add(x + 1, r + 1, e);
        add(x, r + 2, e);
      }
    }
    return on;
  }

  // Atkinson to exactly n dots: the gain is tuned until it lands close, then the palest extras are
  // dropped or the darkest unused pixels switched on
  function ditherExactly(tone, w, h, n) {
    let gain = 1;
    let on = [];
    for (let tries = 0; tries < 12; tries++) {
      on = atkinson(tone, w, h, gain);
      if (Math.abs(on.length - n) <= n * 0.03) break;
      gain = Math.min(4, Math.max(0.2, gain * Math.sqrt(n / Math.max(1, on.length))));
    }
    if (on.length > n) return on.slice().sort((a, b) => tone[b] - tone[a]).slice(0, n);
    if (on.length < n) {
      const isOn = new Uint8Array(w * h);
      for (const i of on) isOn[i] = 1;
      const spare = [];
      for (let i = 0; i < w * h; i++) if (tone[i] >= 0 && !isOn[i]) spare.push(i);
      spare.sort((a, b) => tone[b] - tone[a]);
      return on.concat(spare.slice(0, n - on.length));
    }
    return on;
  }

  // Dither the character once, lit, in a level side view, to exactly N dots, then pin each dot to
  // the surface under it. From then on the dots move with the mesh, so the figure holds together.
  function bindCharacter() {
    const c = character;
    if (!c.renderer || !N || !c.meshes.length) return;
    // the pose it's in: the model's rest pose on the first layout, before any animation has run
    const face = faceConfig();
    c.yawGroup.rotation.y = face.start * face.moving * DEG;
    c.pitchGroup.rotation.z = 0;
    c.scene.updateMatrixWorld(true);

    // a grid with about 1.6 cells of silhouette per dot
    const probe = 96;
    renderCharacter(Math.ceil(probe * 1.6), Math.ceil(probe * 1.2));
    let covered = 0;
    for (let i = 3; i < c.buf.length; i += 4) if (c.buf[i] > 127) covered++;
    const cell = Math.sqrt(Math.max(1, covered) / (probe * probe) / (1.6 * N)); // in character lengths
    const w = Math.max(8, Math.ceil(1.6 / cell));
    const h = Math.max(6, Math.ceil(1.2 / cell));
    renderCharacter(w, h);
    const tone = toneMap(w, h);
    const chosen = ditherExactly(tone, w, h, N);

    // pin: a posed, world-space copy of each mesh to cast rays at, straight into the screen
    const _v = new THREE.Vector3();
    const snaps = c.meshes.map((m, mi) => {
      const g = m.mesh.geometry;
      const count = g.attributes.position.count;
      const arr = new Float32Array(count * 3);
      for (let v = 0; v < count; v++) {
        m.mesh.getVertexPosition(v, _v).applyMatrix4(m.mesh.matrixWorld);
        arr[v * 3] = _v.x;
        arr[v * 3 + 1] = _v.y;
        arr[v * 3 + 2] = _v.z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      if (g.index) geo.setIndex(g.index);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      mesh.userData.mi = mi;
      mesh.updateMatrixWorld(true);
      return mesh;
    });
    const ray = new THREE.Raycaster();
    const dir = new THREE.Vector3(0, 0, -1);
    const origin = new THREE.Vector3();
    const tri = new THREE.Triangle();
    const bary = new THREE.Vector3();
    const pin = { m: new Uint16Array(N), a: new Uint32Array(N), b: new Uint32Array(N), c: new Uint32Array(N), u: new Float32Array(N), v: new Float32Array(N), w: new Float32Array(N), x: new Float32Array(N), y: new Float32Array(N) };
    const nudge = [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]];
    let n = 0;
    for (const pi of chosen) {
      const xx = pi % w;
      const yy = (pi / w) | 0;
      let hit = null;
      for (const [ox, oy] of nudge) {
        origin.set(((xx + 0.5 + ox) / w) * 1.6 - 0.8, ((yy + 0.5 + oy) / h) * 1.2 - 0.6, 10);
        ray.set(origin, dir);
        hit = ray.intersectObjects(snaps, false)[0];
        if (hit) break;
      }
      if (!hit || !hit.face) continue;
      const pa = hit.object.geometry.attributes.position;
      tri.setFromAttributeAndIndices(pa, hit.face.a, hit.face.b, hit.face.c);
      tri.getBarycoord(hit.point, bary);
      pin.m[n] = hit.object.userData.mi;
      pin.a[n] = hit.face.a;
      pin.b[n] = hit.face.b;
      pin.c[n] = hit.face.c;
      pin.u[n] = bary.x;
      pin.v[n] = bary.y;
      pin.w[n] = bary.z;
      pin.x[n] = hit.point.x;
      pin.y[n] = hit.point.y;
      n++;
    }
    // a pixel the rays missed (an edge) borrows a nearby pin, shifted a little across its triangle
    for (let q = 0; n < N; q++, n++) {
      const s = q % Math.max(1, n);
      for (const key of ['m', 'a', 'b', 'c', 'x', 'y']) pin[key][n] = pin[key][s];
      const j = 0.15;
      pin.u[n] = pin.u[s] * (1 - j) + j / 3;
      pin.v[n] = pin.v[s] * (1 - j) + j / 3;
      pin.w[n] = 1 - pin.u[n] - pin.v[n];
    }
    snaps.forEach((s) => {
      s.geometry.dispose();
      s.material.dispose();
    });
    Object.assign(c, { bm: pin.m, ba: pin.a, bb: pin.b, bc: pin.c, bu: pin.u, bv: pin.v, bw: pin.w, px0: pin.x, py0: pin.y, bound: N });
    c.lx = new Float32Array(N);
    c.ly = new Float32Array(N);

    // The order the dots go into the hourglass: lowest first in the dive pose (nose first, head
    // down). Sand keeps that order all the way through, so each dot comes back out to its own place.
    const a = ((opts.hourglass && opts.hourglass.dive) ?? -70) * DEG * face.start;
    const depth = (i) => pin.x[i] * Math.sin(a) + pin.y[i] * Math.cos(a);
    const order = Array.from({ length: N }, (_, i) => i).sort((i, j) => depth(i) - depth(j));
    setOrder(order);
    const d0 = depth(order[0]);
    c.depthExtent = Math.max(1e-6, depth(order[N - 1]) - d0);
    c.depth = Float32Array.from(order, (i) => (depth(i) - d0) / c.depthExtent);
    // and the order places on the character leave for the logo: lowest first, so the figure
    // streams down into it from the feet up
    Array.from({ length: N }, (_, i) => i)
      .sort((i, j) => pin.y[i] - pin.y[j] || pin.x[i] - pin.x[j])
      .forEach((slot, w) => (wordOrder[slot] = w));
  }

  // per frame: each bone's full transform, mesh space to world, so a vertex costs four multiplies
  const _m4 = new THREE.Matrix4();
  const _pre = new THREE.Matrix4();
  const _v3 = new THREE.Vector3();
  const _si = new THREE.Vector4();
  const _sw = new THREE.Vector4();
  function prepareMeshes() {
    character.stamp++;
    for (const m of character.meshes) {
      if (!m.skinned || m.morph) continue;
      const mesh = m.mesh;
      const sk = mesh.skeleton;
      _pre.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
      for (let b = 0; b < sk.bones.length; b++) {
        _m4.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b]).multiply(mesh.bindMatrix).premultiply(_pre);
        m.bones.set(_m4.elements, b * 16);
      }
    }
  }

  function vertex(m, v) {
    if (m.stamp[v] === character.stamp) return;
    m.stamp[v] = character.stamp;
    const o = v * 3;
    const mesh = m.mesh;
    if (m.skinned && !m.morph) {
      const g = mesh.geometry;
      _v3.fromBufferAttribute(g.attributes.position, v);
      _si.fromBufferAttribute(g.attributes.skinIndex, v);
      _sw.fromBufferAttribute(g.attributes.skinWeight, v);
      const e = m.bones;
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < 4; j++) {
        const wt = _sw.getComponent(j);
        if (!wt) continue;
        const b = _si.getComponent(j) * 16;
        x += wt * (e[b] * _v3.x + e[b + 4] * _v3.y + e[b + 8] * _v3.z + e[b + 12]);
        y += wt * (e[b + 1] * _v3.x + e[b + 5] * _v3.y + e[b + 9] * _v3.z + e[b + 13]);
        z += wt * (e[b + 2] * _v3.x + e[b + 6] * _v3.y + e[b + 10] * _v3.z + e[b + 14]);
      }
      m.xyz[o] = x;
      m.xyz[o + 1] = y;
      m.xyz[o + 2] = z;
    } else {
      mesh.getVertexPosition(v, _v3).applyMatrix4(mesh.matrixWorld);
      m.xyz[o] = _v3.x;
      m.xyz[o + 1] = _v3.y;
      m.xyz[o + 2] = _v3.z;
    }
  }

  // Pose the character (gait, scrubbed clips, facing, pitch) and place every pinned dot on screen.
  function poseCharacter(p, prevP, dt, size, pitch) {
    const c = character;
    const len = Math.max(8, size * Math.min(vw, vh));
    // gait comes from its own motion along the keyframes: riding on a moving anchor doesn't count
    let speed = 0;
    let vxs = 0;
    if (c.posed && dt > 1e-4 && p !== prevP) {
      const dx = ((sample('x', p) - sample('x', prevP)) * vw) / 2;
      const dy = ((sample('y', p) - sample('y', prevP)) * vh) / 2;
      vxs = dx / dt / len;
      speed = Math.hypot(dx, dy) / dt / len;
    }
    const k = 1 - Math.exp(-dt / 0.15);
    c.speed += (speed - c.speed) * k;
    c.vx += (vxs - c.vx) * k;
    const anim = c.anim;
    // gait: false never walks or runs on its own; only clips the keyframes scrub (a leap) move it
    if (anim) anim.update(dt, anim.conf.gait === false ? 0 : c.speed, reduce.matches, sampleClip(p));
    const conf = anim ? anim.conf : { walkAbove: 0.08, still: 'pose' };
    const face = faceConfig();
    if (!c.dir) c.dir = face.start;
    let held = 0;
    for (const f of tracks.face) {
      if (f.at > p) break;
      held = f.face;
    }
    if (!c.posed) c.snap = true; // reappearing (out of the sand, say): no turn on the spot
    if (held) c.dir = held;
    else if (Math.abs(c.vx) > conf.walkAbove * 0.5) c.dir = Math.sign(c.vx);
    const st = anim ? anim.state : 'idle';
    if (st !== 'idle') c.moved = true;
    const atRest = st === 'idle' && (conf.still === 'idle' || !c.moved);
    const yaw = c.dir * (atRest ? face.idle : face.moving) * DEG;
    c.yaw = c.snap || Math.abs(yaw - c.yaw) < 1e-3 ? yaw : c.yaw + (yaw - c.yaw) * (1 - Math.exp(-dt * 5));
    c.snap = false;
    c.yawGroup.rotation.y = c.yaw;
    c.pitchGroup.rotation.z = pitch * DEG * c.dir; // nose up, whichever way it faces
    c.scene.updateMatrixWorld(true);

    prepareMeshes();
    for (let i = 0; i < N; i++) {
      const m = c.meshes[c.bm[i]];
      const a = c.ba[i], b = c.bb[i], d = c.bc[i];
      vertex(m, a);
      vertex(m, b);
      vertex(m, d);
      const x = m.xyz;
      c.lx[i] = (c.bu[i] * x[a * 3] + c.bv[i] * x[b * 3] + c.bw[i] * x[d * 3]) * len;
      c.ly[i] = -(c.bu[i] * x[a * 3 + 1] + c.bv[i] * x[b * 3 + 1] + c.bw[i] * x[d * 3 + 1]) * len;
    }

    // its outline (for `align: 'bottom' | 'top'`), and where its leading point is when it passes
    // through an anchor head first (`align: 'pour' | 'emerge'`): fitted over every dot's depth along
    // the way its nose points, so a swinging leg doesn't jog it
    // (depth is height in the dive pose, so moving `ext` along the nose's line takes it down one
    // whole depth)
    const ux = c.dir * Math.cos(pitch * DEG);
    const uy = -Math.sin(pitch * DEG);
    const ext = (c.depthExtent * len) / Math.max(0.2, uy);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sx = 0, sLead = 0;
    for (let i = 0; i < N; i++) {
      const x = c.lx[i];
      const y = c.ly[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const d = c.depth[pos[i]] * ext;
      sx += x + d * ux;
      sLead += y + d * uy;
    }
    c.box = { cx: (minX + maxX) / 2, minY, maxY };
    c.fit = { leadX: sx / N, lead: sLead / N, extent: ext, ux, uy };
    c.cx = ((sample('x', p) + 1) / 2) * vw;
    c.cy = ((1 - sample('y', p)) / 2) * vh;
    c.posed = true;
  }

  /* ---------- the hourglass ---------- */

  // Shared shape (box units): half-width of the glass at height v, 0..1 from top to bottom.
  const HG = { v0: 0.05, v1: 0.95, neck: 0.03, max: 0.4 };
  function halfWidth(v) {
    const t = Math.min(1, Math.abs(v - 0.5) / (0.5 - HG.v0));
    return HG.neck + (HG.max - HG.neck) * Math.sqrt(Math.max(0, 1 - (1 - t) ** 2));
  }

  const hourglass = { el: null, panel: null, w: 0, h: 0, n: 0, gap: 4, top: null, bottom: null, topN: 0, bottomN: 0, lastLeft: 0, lastTop: null };

  function hourglassPath() {
    // the glass's two sides in a 100 x 150 viewBox, open at both ends (the way in and the way out);
    // the sand cells use the same halfWidth()
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const v = HG.v0 + ((HG.v1 - HG.v0) * i) / 60;
      pts.push([(0.5 + halfWidth(v)) * 100, v * 150]);
    }
    const right = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`);
    const left = pts.map(([x, y]) => `${(100 - x).toFixed(2)},${y.toFixed(2)}`);
    return `M${right.join(' L')} M${left.join(' L')}`;
  }

  function hourglassCells(r, gap) {
    const wall = (gap * 1.1) / r.width;
    const top = [];
    const bottom = [];
    for (let y = gap / 2; y < r.height; y += gap) {
      const v = y / r.height;
      if (v < HG.v0 + 0.01 || v > HG.v1 - 0.01 || Math.abs(v - 0.5) < 0.012) continue;
      for (let x = gap / 2; x < r.width; x += gap) {
        const u = x / r.width;
        if (Math.abs(u - 0.5) < halfWidth(v) - wall) (v < 0.5 ? top : bottom).push([x, y, u, v]);
      }
    }
    return { top, bottom };
  }

  function buildHourglassCells() {
    const r = hourglass.el.getBoundingClientRect();
    if (!r.width || (r.width === hourglass.w && r.height === hourglass.h && hourglass.n === N)) return;
    hourglass.w = r.width;
    hourglass.h = r.height;
    hourglass.n = N;
    // pick the grid so each bulb holds every dot in the pool (with a little headroom): the same dots,
    // one per cell, no doubling up
    let gap = opts.gap;
    let cells = hourglassCells(r, gap);
    for (let tries = 0; tries < 6; tries++) {
      const cap = Math.min(cells.top.length, cells.bottom.length);
      if (cap >= N * 1.04 && cap <= N * 1.35) break;
      gap *= Math.sqrt(cap / (N * 1.15));
      cells = hourglassCells(r, gap);
    }
    hourglass.gap = gap;
    // The order cells fill in, layer by layer. The top bulb's level layers fill from the walls in, so
    // the middle sits a little low as it pours and is first to go when it drains (a funnel); the
    // bottom bulb builds a mound from the base.
    const layered = (list, key, across) => {
      const layers = new Map();
      for (const c of list) {
        const L = Math.floor(key(c) / gap + 1e-6);
        if (!layers.has(L)) layers.set(L, []);
        layers.get(L).push(c);
      }
      const order = [];
      [...layers.keys()].sort((a, b) => a - b).forEach((L) => order.push(...layers.get(L).sort(across)));
      return order;
    };
    const mid = r.width / 2;
    const top = layered(cells.top, (c) => r.height * 0.5 - c[1], (a, b) => Math.abs(b[0] - mid) - Math.abs(a[0] - mid) || a[0] - b[0]);
    const slope = (0.7 * r.height) / r.width;
    const bottom = layered(cells.bottom, (c) => r.height * HG.v1 - c[1] + slope * Math.abs(c[0] - mid), (a, b) => a[0] - b[0]);
    hourglass.top = Float32Array.from(top.flatMap((c) => [c[0], c[1]]));
    hourglass.bottom = Float32Array.from(bottom.flatMap((c) => [c[0], c[1]]));
    hourglass.topN = top.length;
    hourglass.bottomN = bottom.length;
  }

  // how many dots (in pour order) lie less than v of the way along the dive
  function countBelow(v) {
    const d = character.depth;
    let lo = 0;
    let hi = N;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (d[m] < v) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  // How far the flow has got. `pour` is how far the character has passed the inlet, in lengths, so
  // `inn` dots are past it, and `landed` of those have fallen all the way onto the sand (a dot falls
  // while the character goes `crumble` further). `drained` dots have left the top bulb (the last
  // `stream` still on their way down). Once all the sand is at the bottom, `emerge` brings the
  // character out the same way: `leaving` dots have set off from the mound and `out` are back in it.
  // The sand can only move so fast (per second). On a flick the flow falls behind the scroll and
  // catches up a moment after it stops, instead of skipping dots past their way through the glass;
  // ordinary scrolling stays under these.
  const FLOW_SPEED = { pour: 3, drain: 1.2, emerge: 3 };
  const MORPH_SPEED = 2.5; // picture to character, per second
  const flowNow = { pour: null, drain: null, emerge: null };
  function limitFlow(pose, dt) {
    const w = flowWindows();
    let behind = false;
    const step = (k, to) => {
      if (flowNow[k] === null || reduce.matches || !ready) flowNow[k] = to;
      else flowNow[k] += Math.max(-FLOW_SPEED[k] * dt, Math.min(FLOW_SPEED[k] * dt, to - flowNow[k]));
      if (Math.abs(flowNow[k] - to) < 1e-6) flowNow[k] = to;
      else behind = true;
    };
    // sand only moves on once it has landed: the drain waits for the pour, and the character only
    // comes out once all the sand is at the bottom, so every dot takes its whole way through
    step('pour', pose.pour);
    const landed = countBelow(flowNow.pour - w.crumble);
    step('drain', landed < N ? Math.min(pose.drain, landed / (N + w.stream)) : pose.drain);
    const low = Math.min(1, Math.max(0, flowNow.drain)) * (N + w.stream) - w.stream;
    step('emerge', low >= N ? pose.emerge : Math.min(pose.emerge, -w.exit));
    return behind;
  }

  function flowWindows() {
    return { crumble: (opts.hourglass && opts.hourglass.crumble) ?? 0.3, exit: 0.35, stream: Math.max(16, Math.round(N * 0.08)) };
  }

  function computeFlow(pose) {
    if (!hourglass.el || !N) return null;
    const { crumble, exit, stream } = flowWindows();
    const pour = pose.pour;
    const emerge = pose.emerge;
    const inn = countBelow(pour);
    const landed = countBelow(pour - crumble);
    let drained = Math.min(1, Math.max(0, pose.drain)) * (N + stream);
    if (landed < N) drained = Math.min(drained, landed);
    const low = Math.max(0, drained - stream);
    const all = low >= N;
    const leaving = all ? countBelow(emerge + exit) : 0;
    const out = all ? countBelow(emerge) : 0;
    return { pour, emerge, inn, landed, drained, low, leaving, out, crumble, exit, stream };
  }

  // The sand's route, worked out once per layout by running the pour and drain forward. The top bulb
  // is a stack: sand lands on top and the top layer runs out first, down the middle to the neck, the
  // way real sand funnels. The bottom bulb fills in arrival order and empties from the top of its
  // mound. Sand keeps its cell while it waits, so the piles never shuffle.
  const sand = { cellTop: null, popIndex: null };
  function planSand() {
    sand.cellTop = sand.popIndex = null;
    if (!hourglass.el || !N) return;
    const cellTop = new Int32Array(N); // by pour order: its cell in the top bulb
    const popIndex = new Int32Array(N); // by pour order: its turn through the neck
    const stack = [];
    let landedN = 0;
    let drainedN = 0;
    const steps = Math.max(2000, N * 6);
    for (let s = 0; s <= steps; s++) {
      const p = s / steps;
      const fl = computeFlow({ pour: sample('pour', p), drain: sample('drain', p), emerge: 0 });
      const L = Math.min(N, Math.floor(fl.landed));
      const D = Math.min(N, Math.floor(fl.drained));
      while (landedN < L) {
        cellTop[landedN] = stack.length;
        stack.push(landedN++);
      }
      while (drainedN < D && stack.length) popIndex[stack.pop()] = drainedN++;
    }
    // sand the keyframes never pour or drain still gets a place, in the same order
    while (landedN < N) {
      cellTop[landedN] = stack.length;
      stack.push(landedN++);
    }
    while (stack.length) popIndex[stack.pop()] = drainedN++;
    sand.cellTop = cellTop;
    sand.popIndex = popIndex;
  }

  // what dot k (in pour order) is doing; on the way out the top of the mound goes first
  function flowState(k, fl) {
    if (k >= fl.inn) return BODY; // still the character, outside the glass
    if (k >= fl.landed) return FALL;
    const m = sand.popIndex[k];
    if (m >= fl.drained) return TOP;
    if (m >= fl.low) return NECK;
    const e = N - 1 - m;
    if (e >= fl.leaving) return BOTTOM;
    if (e >= fl.out) return EXIT;
    return BODY; // back in the character
  }

  // the place on the character a dot fills: its own until it goes into the glass; coming out, the
  // first dot out takes the first place in (the nose), and so on, so the figure comes out nose first
  function slotOf(i, k, fl) {
    return fl && sand.popIndex && k < fl.inn ? byPos[N - 1 - sand.popIndex[k]] : i;
  }

  /* ---------- the logo ---------- */

  const logo = { el: null, pts: new Float32Array(0), count: 0, gap: 4, width: 0, lastLeft: 0, lastTop: null };

  function setFont(c, size, o) {
    c.font = `${o.fontWeight || 800} ${size}px "${o.fontFamily || 'Archivo'}", "Arial Black", sans-serif`;
    if ('fontStretch' in c) c.fontStretch = o.fontStretch || 'expanded';
  }

  function textWidth(c, str, size, o) {
    setFont(c, size, o);
    let w = 0;
    for (const ch of str) w += c.measureText(ch).width;
    return w + (o.tracking ?? 0.03) * size * (str.length - 1);
  }

  function layoutLogo() {
    const o = opts.logo;
    const width = logo.el.clientWidth;
    if (!width) return false;
    logo.width = width;
    const m = document.createElement('canvas').getContext('2d');
    const fit = (str) => ({ str, size: (100 * width * 0.995) / textWidth(m, str, 100, o) });
    const one = fit(o.text);
    const lines = one.size >= (o.stackBelow ?? 56) || !o.text.includes(' ') ? [one] : o.text.split(/\s+/).map(fit);
    const cap = o.capHeight ?? 0.72;
    const minCap = Math.min(...lines.map((l) => l.size)) * cap;
    const gap = Math.max(o.minGap ?? 2.5, Math.min(o.maxGap ?? 7, minCap / (o.dotsPerCap ?? 10)));
    const lineGap = gap * 4;
    const textH = lines.reduce((s, l) => s + l.size * cap, 0) + lineGap * (lines.length - 1);
    const H = Math.ceil(textH + gap * 2);
    logo.el.style.height = `${H}px`;
    const off = document.createElement('canvas');
    off.width = Math.ceil(width);
    off.height = H;
    const oc = off.getContext('2d', { willReadFrequently: true });
    let baseline = 0;
    for (const line of lines) {
      baseline += line.size * cap;
      let x = (width - textWidth(oc, line.str, line.size, o)) / 2;
      for (const ch of line.str) {
        oc.fillText(ch, x, baseline);
        x += oc.measureText(ch).width + (o.tracking ?? 0.03) * line.size;
      }
      baseline += lineGap;
    }
    const data = oc.getImageData(0, 0, off.width, off.height).data;
    const pts = [];
    for (let x = gap / 2; x < width; x += gap) {
      // column by column, so the wordmark builds up from left to right
      for (let y = gap / 2; y < H; y += gap) {
        if (data[((y | 0) * off.width + (x | 0)) * 4 + 3] > 127) pts.push(x, y);
      }
    }
    logo.pts = Float32Array.from(pts);
    logo.count = pts.length / 2;
    logo.gap = gap;
    return true;
  }

  /* ---------- the image ---------- */

  // Each dot's place on the picture (CSS px from the element's corner), the place on the character
  // each one goes to, and the order they leave in.
  const image = { el: null, pts: new Float32Array(0), of: null, rank: null, lastLeft: 0, lastTop: null, reveal: -1 };

  // Dither the picture, as drawn in its element, to exactly N dots: darker means denser, and pale
  // but solid parts keep a sprinkling so their outline still reads.
  function layoutImage() {
    const el = image.el;
    image.of = null;
    if (!el || !N || !el.naturalWidth) return false;
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (!W || !H) return false;
    const o = opts.image || {};
    const toneAt = (gw, gh) => {
      const c = document.createElement('canvas');
      c.width = gw;
      c.height = gh;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingQuality = 'high';
      x.drawImage(el, 0, 0, gw, gh);
      const d = x.getImageData(0, 0, gw, gh).data;
      const tone = new Float32Array(gw * gh);
      const k = o.contrast ?? 1;
      for (let r = 0; r < gh; r++) {
        for (let q = 0; q < gw; q++) {
          const i = (r * gw + q) * 4;
          const j = (gh - 1 - r) * gw + q; // bottom row first, as atkinson() reads it
          const a = d[i + 3] / 255;
          if (a < 0.2) {
            tone[j] = -1;
            continue;
          }
          const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
          tone[j] = Math.min(1, Math.max(0.05, (1 - lum) * k * a));
        }
      }
      return tone;
    };
    // a grid whose cells hold about one dot's worth of darkness each
    const probeW = 96;
    const probeH = Math.max(1, Math.round((probeW * H) / W));
    let sum = 0;
    for (const t of toneAt(probeW, probeH)) if (t > 0) sum += t;
    const cell = Math.max(1, Math.sqrt((sum / (probeW * probeH)) * W * H / N));
    const gw = Math.max(8, Math.round(W / cell));
    const gh = Math.max(8, Math.round(H / cell));
    const tone = toneAt(gw, gh);
    const chosen = ditherExactly(tone, gw, gh, N);
    const pts = new Float32Array(N * 2);
    chosen.forEach((idx, n) => {
      pts[n * 2] = ((idx % gw) + 0.5) * (W / gw);
      pts[n * 2 + 1] = (gh - 1 - ((idx / gw) | 0) + 0.5) * (H / gh);
    });
    // short of pixels (a tiny picture): the rest double up
    for (let n = chosen.length; n < N; n++) {
      pts[n * 2] = pts[(n % Math.max(1, chosen.length)) * 2];
      pts[n * 2 + 1] = pts[(n % Math.max(1, chosen.length)) * 2 + 1];
    }
    image.pts = pts;
    mapImage();
    return true;
  }

  // Match picture dots to places on the character, shape to shape: both cut into the same number of
  // horizontal bands (equal counts, top to bottom) and paired left to right within each, so a head
  // goes to a head and feet to feet. Dots leave the picture from the top down.
  function mapImage() {
    const c = character;
    if (!image.pts.length || c.bound !== N || !c.px0) return;
    const flip = (opts.image && opts.image.flip) ? -1 : 1;
    const ids = () => Array.from({ length: N }, (_, i) => i);
    const banded = (xs, ys) => {
      const byY = ids().sort((a, b) => ys(a) - ys(b));
      const bands = Math.max(1, Math.round(Math.sqrt(N) / 2));
      const out = [];
      for (let b = 0; b < bands; b++) {
        const part = byY.slice(Math.round((b * N) / bands), Math.round(((b + 1) * N) / bands));
        part.sort((p, q) => xs(p) - xs(q));
        out.push(...part);
      }
      return out;
    };
    const pic = banded((i) => image.pts[i * 2], (i) => image.pts[i * 2 + 1]);
    const slots = banded((j) => c.px0[j] * flip, (j) => -c.py0[j]); // pinned in the pose it starts in
    image.of = new Int32Array(N);
    image.rank = new Float32Array(N);
    const yRank = new Float32Array(N);
    ids()
      .sort((a, b) => image.pts[a * 2 + 1] - image.pts[b * 2 + 1])
      .forEach((m, r) => (yRank[m] = r / N));
    slots.forEach((j, n) => {
      image.of[j] = pic[n];
      image.rank[j] = yRank[pic[n]];
    });
  }

  /* ---------- particles ---------- */

  function allocate(n) {
    N = n;
    px = new Float32Array(n);
    py = new Float32Array(n);
    vx = new Float32Array(n);
    vy = new Float32Array(n);
    ease = new Float32Array(n);
    fric = new Float32Array(n);
    spread = new Float32Array(n);
    wordOrder = new Int32Array(n);
    jit = new Float32Array(n);
    pos = new Int32Array(n);
    byPos = new Int32Array(n);
    state = new Int8Array(n).fill(-1);
    ptx = new Float32Array(n);
    pty = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      px[i] = Math.random() * vw; // scattered at first; they gather into the first form
      py[i] = Math.random() * vh;
      ease[i] = 0.06 + Math.random() * 0.06;
      fric[i] = 0.8 + Math.random() * 0.12;
      jit[i] = Math.random(); // how long it clings to the body before it falls (a ragged edge)
      spread[i] = Math.random(); // how far out of turn it leaves for the logo
      wordOrder[i] = i;
    }
    setOrder(Array.from({ length: n }, (_, i) => i));
    character.depth = Float32Array.from({ length: n }, (_, k) => k / n); // until the character is pinned
    character.depthExtent = 1;
    character.bound = 0;
  }

  // order[k] is the k-th dot into the hourglass
  function setOrder(order) {
    order.forEach((i, k) => {
      pos[i] = k;
      byPos[k] = i;
    });
  }

  function drawSprites() {
    for (const [key, sprite] of Object.entries(sprites)) {
      const size = Math.ceil(dotR * 2 * dpr) + 2;
      sprite.width = sprite.height = size;
      const s = sprite.getContext('2d');
      s.fillStyle = colors[key];
      s.beginPath();
      s.arc(size / 2, size / 2, dotR * dpr, 0, Math.PI * 2);
      s.fill();
      spriteR = size / 2;
    }
  }

  function readColors() {
    const cs = getComputedStyle(canvas);
    colors.ink = cs.color || colors.ink;
    colors.panel = cs.getPropertyValue('--panel-dots').trim() || colors.panel;
    drawSprites();
  }

  /* ---------- per frame ---------- */

  const out = { x: 0, y: 0 };

  function cell(list, count, j, g) {
    const q = Math.min(count - 1, Math.max(0, j)) * 2;
    out.x = g.left + list[q];
    out.y = g.top + list[q + 1];
  }

  // target for dot i (k-th in the pour order) in state st
  function flowTarget(st, i, k, fl, g) {
    const c = character;
    if (st === BODY) {
      const j = slotOf(i, k, fl);
      out.x = c.cx + c.lx[j];
      out.y = c.cy + c.ly[j];
    } else if (st === FALL) {
      // clings to the body a moment (each dot for its own time, so the edge crumbles raggedly),
      // then drops straight down and only spreads out as it lands on the sand
      const d = jit[i] * 0.45;
      const f = Math.min(1, Math.max(0, ((fl.pour - character.depth[k]) / fl.crumble - d) / (1 - d)));
      cell(hourglass.top, hourglass.topN, sand.cellTop[k], g);
      const sx = c.cx + c.lx[i];
      const sy = c.cy + c.ly[i];
      out.x = sx + (out.x - sx) * f * f * f;
      out.y = sy + (out.y - sy) * f * f;
    } else if (st === TOP) {
      cell(hourglass.top, hourglass.topN, sand.cellTop[k], g);
    } else if (st === NECK) {
      // down the middle of the sand to the neck, then a thin stream that fans out near the mound
      const m = sand.popIndex[k];
      const f = (fl.drained - m) / fl.stream;
      const nx = g.left + hourglass.w / 2 + ((m & 1) - 0.5) * hourglass.gap * 0.6;
      const ny = g.top + 0.5 * hourglass.h;
      if (f < 0.35) {
        cell(hourglass.top, hourglass.topN, sand.cellTop[k], g);
        const e = (f / 0.35) ** 2;
        out.x += (nx - out.x) * e;
        out.y += (ny - out.y) * e;
      } else {
        const t = (f - 0.35) / 0.65;
        cell(hourglass.bottom, hourglass.bottomN, m, g);
        out.x = nx + (out.x - nx) * t ** 5; // a narrow column that only spreads onto the mound
        out.y = ny + (out.y - ny) * t * t;
      }
    } else if (st === BOTTOM) {
      cell(hourglass.bottom, hourglass.bottomN, sand.popIndex[k], g);
    } else if (st === EXIT) {
      // down through the mound to the opening in the base, then to its place on the character, which
      // reaches the opening just as the dot does
      const m = sand.popIndex[k];
      const e = N - 1 - m;
      const f = Math.min(1, Math.max(0, (fl.emerge + fl.exit - character.depth[e]) / fl.exit));
      const sx = g.left + hourglass.w / 2;
      const sy = g.top + HG.v1 * hourglass.h;
      if (f < 0.55) {
        cell(hourglass.bottom, hourglass.bottomN, m, g);
        const q = (f / 0.55) ** 2;
        out.x += (sx - out.x) * q;
        out.y += (sy - out.y) * q;
      } else {
        const t = smoothstep((f - 0.55) / 0.45);
        const j = byPos[e];
        out.x = sx + (c.cx + c.lx[j] - sx) * t;
        out.y = sy + (c.cy + c.ly[j] - sy) * t;
      }
    }
  }

  function frame(now) {
    rafId = 0;
    const dt = Math.min(0.1, lastTime ? (now - lastTime) / 1000 : 1 / 60);
    lastTime = now;
    const step = dt * 60;

    target = range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0;
    if (!ready || reduce.matches || opts.damping <= 0) smooth = target;
    else {
      smooth += (target - smooth) * (1 - Math.exp(-opts.damping * dt));
      // the page itself doesn't lag, so neither may the story by much: on a flick it keeps pace
      const cap = ((opts.maxLag ?? 0.12) * vh) / range;
      smooth = Math.min(target + cap, Math.max(target - cap, smooth));
      if (Math.abs(target - smooth) < 1e-5) smooth = target;
    }
    const p = smooth;
    const prevP = lastP;
    lastP = p;
    const pose = {};
    for (const k of NUM_KEYS) pose[k] = sample(k, p);
    const form = sampleForm(p);
    const flowBehind = limitFlow(pose, dt);
    const fl = computeFlow(flowNow);

    // the character is needed while any dot is (or is turning into, or out of) part of it
    const allLogo = form.a === 'logo' && (form.blend === 0 || form.b === 'logo');
    // how far the dots have gone from the picture to the character, 0..1: like the sand, it can only
    // go so fast, so on a flick every dot still takes its whole path instead of skipping it
    const morphTo = !image.el ? 1 : form.a === 'image' ? (form.b === 'image' ? 0 : form.blend) : form.b === 'image' ? 1 - form.blend : 1;
    if (morphNow === null || reduce.matches || !ready) morphNow = morphTo;
    else morphNow += Math.max(-MORPH_SPEED * dt, Math.min(MORPH_SPEED * dt, morphTo - morphNow));
    if (Math.abs(morphNow - morphTo) < 1e-6) morphNow = morphTo;
    const morphBehind = morphNow !== morphTo;
    const allImage = !!image.el && morphNow <= 0;
    const allSand = fl && fl.landed >= N && fl.leaving <= 0;
    const charOn = character.bound === N && !allLogo && !allImage && !allSand;
    if (charOn) poseCharacter(p, prevP, dt, pose.size, pose.pitch);
    else character.posed = false;

    let g = null;
    let gdx = 0;
    let gdy = 0;
    if (fl && fl.inn > 0) {
      buildHourglassCells();
      const r = hourglass.el.getBoundingClientRect();
      g = { left: r.left, top: r.top };
      if (hourglass.lastTop !== null) {
        gdx = r.left - hourglass.lastLeft;
        gdy = r.top - hourglass.lastTop;
      }
      hourglass.lastLeft = r.left;
      hourglass.lastTop = r.top;
    } else hourglass.lastTop = null;
    let logoLeft = 0;
    let logoTop = 0;
    let ldx = 0;
    let ldy = 0;
    if (logo.el && (form.a === 'logo' || form.b === 'logo')) {
      const r = logo.el.getBoundingClientRect();
      logoLeft = r.left;
      logoTop = r.top;
      if (logo.lastTop !== null) {
        ldx = r.left - logo.lastLeft;
        ldy = r.top - logo.lastTop;
      }
      logo.lastLeft = r.left;
      logo.lastTop = r.top;
    } else logo.lastTop = null;
    let imageLeft = 0;
    let imageTop = 0;
    let idx = 0;
    let idy = 0;
    const withImage = !!image.el && image.pts.length > 0 && morphNow < 1;
    if (withImage) {
      const r = image.el.getBoundingClientRect();
      imageLeft = r.left;
      imageTop = r.top;
      if (image.lastTop !== null) {
        idx = r.left - image.lastLeft;
        idy = r.top - image.lastTop;
      }
      image.lastLeft = r.left;
      image.lastTop = r.top;
    } else image.lastTop = null;
    revealNow = withImage ? Math.min(1, Math.max(0, pose.reveal)) : 1;
    if (image.el && revealNow !== image.reveal) {
      image.reveal = revealNow;
      image.el.style.setProperty('--dots-reveal', revealNow.toFixed(3));
    }

    // physics: follow the target, spring back from the pointer
    const R = opts.pointer.radius;
    const R2 = R * R;
    const active = now < pointer.until && !reduce.matches;
    let moving = false;
    let lagSum = 0, lagMax = 0, lagN = 0; // debug: how far the character's dots trail their places
    for (let i = 0; i < N; i++) {
      const k = pos[i];
      // The place it fills on the character decides when it leaves for the logo (in that order,
      // with some scatter) and where it lands there (the logo builds up from left to right), and
      // likewise its place on the picture and when it leaves it (from the top down).
      const j = slotOf(i, k, fl);
      const w = form.a === 'logo' || form.b === 'logo' ? wordOrder[j] : 0;
      let f = form.a === 'image' ? 'character' : form.a;
      let u = 1; // between the picture and the character: how far along its own path, 0..1
      if (withImage) {
        // each dot takes a straight, eased path of its own, in turn from the top of the picture down
        u = image.rank ? Math.min(1, Math.max(0, (morphNow - (image.rank[j] * 0.6 + spread[i] * 0.25)) / 0.15)) : morphNow;
        f = u >= 1 ? 'character' : u <= 0 ? 'image' : 'morph';
      } else if (form.blend > 0 && (w / N) * 0.82 + spread[i] * 0.18 < form.blend) f = form.b === 'image' ? 'character' : form.b;
      let st;
      if (f === 'morph') {
        if (!image.pts.length || !charOn) continue;
        st = MORPH;
        const m = image.of ? image.of[j] : j;
        const t = smoothstep(u);
        const ix = imageLeft + image.pts[m * 2];
        const iy = imageTop + image.pts[m * 2 + 1];
        const bx = character.cx + character.lx[j];
        const by = character.cy + character.ly[j];
        out.x = ix + (bx - ix) * t;
        out.y = iy + (by - iy) * t - Math.sin(Math.PI * t) * 18; // a slight hop on the way
      } else if (f === 'image') {
        if (!image.pts.length) continue;
        st = IMAGE;
        const m = image.of ? image.of[j] : j;
        out.x = imageLeft + image.pts[m * 2];
        out.y = imageTop + image.pts[m * 2 + 1];
      } else if (f === 'logo') {
        if (!logo.count) continue;
        st = LOGO;
        const j = w % logo.count;
        out.x = logoLeft + logo.pts[j * 2];
        out.y = logoTop + logo.pts[j * 2 + 1];
      } else {
        st = g && sand.popIndex ? flowState(k, fl) : BODY;
        if ((st === BODY || st === FALL || st === EXIT) && !charOn) continue;
        flowTarget(st, i, k, fl, g);
      }
      if (reduce.matches) {
        px[i] = out.x;
        py[i] = out.y;
        state[i] = st;
        continue;
      }
      // Carry: a dot moves with its target, so the character and the sand hold together however fast
      // they travel; the spring below only settles what the pointer (or a change of form) displaced.
      const was = state[i];
      if (was === LOGO && st === LOGO) {
        px[i] += ldx; // a formed logo moves with the page, so it holds together wherever it sits
        py[i] += ldy;
      } else if (st === IMAGE && (was === IMAGE || was < 0)) {
        if (was < 0) {
          px[i] = out.x; // the picture is there from the start, nothing gathers into it
          py[i] = out.y;
        }
        px[i] += idx; // and it moves with the page too
        py[i] += idy;
      } else if (was >= 0 && was !== LOGO && st !== LOGO && (was !== IMAGE || st === MORPH) && (st !== IMAGE || was === MORPH)) {
        if (was === st && (st === TOP || st === BOTTOM)) {
          px[i] += gdx; // sand moves with the glass and settles into its next cell
          py[i] += gdy;
        } else if (was === st || SMOOTH.has(was * 16 + st)) {
          px[i] += out.x - ptx[i];
          py[i] += out.y - pty[i];
        }
      }
      state[i] = st;
      ptx[i] = out.x;
      pty[i] = out.y;
      if (active) {
        const dx = px[i] - pointer.x;
        const dy = py[i] - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const push = (1 - d / R) * opts.pointer.force * (0.5 + Math.random()) * step;
          vx[i] += (dx / d) * push + (Math.random() - 0.5) * 0.6 * step;
          vy[i] += (dy / d) * push + (Math.random() - 0.5) * 0.6 * step;
        }
      }
      const fr = Math.pow(fric[i], step);
      const kk = 1 - Math.pow(1 - ease[i], step);
      vx[i] *= fr;
      vy[i] *= fr;
      px[i] += vx[i] * step + (out.x - px[i]) * kk;
      py[i] += vy[i] * step + (out.y - py[i]) * kk;
      if (!moving && (Math.abs(out.x - px[i]) + Math.abs(out.y - py[i]) > 0.2 || Math.abs(vx[i]) + Math.abs(vy[i]) > 0.05)) moving = true;
      if (debugEl && st === BODY) {
        const lag = Math.hypot(out.x - px[i], out.y - py[i]);
        lagSum += lag;
        lagN++;
        if (lag > lagMax) lagMax = lag;
      }
    }
    paint();

    // only clips that play in time keep the loop going; scrubbed and held poses are static
    const st = character.anim && charOn ? character.anim.state : 'idle';
    const animating = flowBehind || morphBehind || st === 'walk' || st === 'run' || st === 'manual' || (st === 'idle' && character.anim?.conf.still === 'idle');
    const settled = !moving && !active && smooth === target && !animating;
    canvas.dataset.settled = String(settled);
    if (debugEl) {
      const flowText = fl ? `pour ${fl.pour.toFixed(2)} drain ${flowNow.drain.toFixed(2)} emerge ${fl.emerge.toFixed(2)}${flowBehind ? ' (catching up)' : ''}  in ${fl.inn} landed ${fl.landed} drained ${fl.drained | 0} out ${fl.out}` : '';
      debugEl.textContent =
        `dot-story  progress ${p.toFixed(3)}  form ${form.a}${form.blend > 0 ? ` → ${form.b} ${(form.blend * 100) | 0}%` : ''}\n` +
        `size ${pose.size.toFixed(2)} pitch ${pose.pitch.toFixed(0)}  ${flowText}\n` +
        `dots ${N}  pinned ${character.bound}  ${character.anim ? character.anim.state : ''}  centre ${character.cx.toFixed(1)},${character.cy.toFixed(1)}\n` +
        `scroll lag ${((target - smooth) * range).toFixed(0)}px  body lag avg ${(lagSum / Math.max(1, lagN)).toFixed(1)} max ${lagMax.toFixed(0)}px`;
    }
    if (!settled) schedule();
    else lastTime = 0;
  }

  // the dots, with the picture's fading in by `reveal`; `inside` limits them to a rect
  function drawDots(sprite, inside) {
    const fade = revealNow < 1;
    for (let pass = 0; pass < (fade ? 2 : 1); pass++) {
      if (pass === 1) {
        if (revealNow <= 0) break;
        ctx.globalAlpha = revealNow;
      }
      for (let i = 0; i < N; i++) {
        if (fade && (state[i] === IMAGE) !== (pass === 1)) continue;
        const x = px[i];
        const y = py[i];
        if (inside && !(x > inside.left - 4 && x < inside.right + 4 && y > inside.top - 4 && y < inside.bottom + 4)) continue;
        ctx.drawImage(sprite, x * dpr - spriteR, y * dpr - spriteR);
      }
    }
    ctx.globalAlpha = 1;
  }

  function paint() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawDots(sprites.ink, null);
    // inside dark areas (the hourglass panel, and any `inverse` element) the dots use the panel colour
    for (const area of inverseAreas) {
      const r = area.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh || !r.width) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr);
      ctx.clip();
      ctx.clearRect(r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr);
      drawDots(sprites.panel, r);
      ctx.restore();
    }
  }

  function schedule() {
    if (rafId || destroyed) return;
    rafId = requestAnimationFrame(frame);
  }

  /* ---------- layout ---------- */

  function layout() {
    opts = computeOptions();
    inverseAreas = [...new Set([hourglass.panel, ...(opts.inverse ? document.querySelectorAll(opts.inverse) : [])].filter(Boolean))];
    vw = window.innerWidth;
    vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    range = Math.max(1, document.documentElement.scrollHeight - vh);
    if (logo.el) layoutLogo();
    hourglass.w = 0; // rebuild the sand cells for the new size
    buildFrames();
    const n = logo.count || opts.particles;
    if (n !== N) allocate(n);
    if (character.bound !== N) bindCharacter(); // pin the new pool to the character
    if (image.el) layoutImage();
    planSand();
    // one dot size everywhere, so it reads as the same dots in every form
    dotR = opts.dotRadius || Math.min(1.6, Math.max(0.9, (logo.count ? logo.gap : opts.gap * 1.4) * 0.24));
    readColors();
    schedule();
  }

  let layoutQueued = false;
  const queueLayout = () => {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      layout();
    });
  };

  const onScroll = () => {
    if (window.scrollY !== lastScrollY) {
      lastScrollY = window.scrollY;
      schedule();
    }
  };
  const onPointer = (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.until = performance.now() + 120;
    schedule();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('resize', queueLayout);
  const ro = new ResizeObserver(queueLayout);
  ro.observe(document.body);
  const themeObserver = new MutationObserver(() => {
    readColors();
    schedule();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    readColors();
    schedule();
  });
  Object.keys(base.responsive || {}).forEach((q) => matchMedia(q).addEventListener('change', queueLayout));

  if (debug) {
    debugEl = document.createElement('div');
    debugEl.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none;white-space:pre;' +
      'font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#fff;background:rgba(0,0,0,.78);padding:8px 10px;border-radius:8px';
    document.body.appendChild(debugEl);
  }

  /* ---------- start ---------- */

  if (base.hourglass) {
    hourglass.el = document.querySelector(base.hourglass.anchor);
    hourglass.panel = base.hourglass.panel ? document.querySelector(base.hourglass.panel) : null;
    const path = hourglass.el && hourglass.el.querySelector('[data-hourglass-glass]');
    if (path) path.setAttribute('d', hourglassPath());
  }
  if (base.image) {
    image.el = document.querySelector(base.image.anchor);
    if (!image.el) console.warn(`[dot-story] image "${base.image.anchor}" not found`);
  }
  if (base.logo) {
    logo.el = document.querySelector(base.logo.anchor);
    if (logo.el && !logo.el.getAttribute('aria-label')) logo.el.setAttribute('aria-label', base.logo.text);
  }

  const font = base.logo ? `${base.logo.fontWeight || 800} ${base.logo.fontStretch || 'expanded'} 100px "${base.logo.fontFamily || 'Archivo'}"` : null;
  const fontReady = font && document.fonts?.load ? document.fonts.load(font).catch(() => {}) : Promise.resolve();
  const timeout = new Promise((res) => setTimeout(res, 2500));
  const charReady = base.character ? loadCharacter(base.character) : Promise.resolve();
  const imageReady = image.el && image.el.decode ? image.el.decode().catch(() => {}) : Promise.resolve();

  const api = {
    get progress() {
      return smooth;
    },
    get particles() {
      return N;
    },
    relayout: queueLayout,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', queueLayout);
      ro.disconnect();
      themeObserver.disconnect();
      character.anim?.dispose();
      character.rt?.dispose();
      character.renderer?.dispose();
      debugEl?.remove();
    },
    ready: null,
  };

  api.ready = Promise.all([Promise.race([fontReady, timeout]), charReady, imageReady]).then(() => {
    layout();
    ready = true;
    canvas.dataset.ready = 'true';
    canvas.classList.add('is-ready');
    fontReady.then(() => logo.el && queueLayout()); // re-sample the logo if the font arrives late
    return api;
  });
  api.ready.catch((err) => console.error('[dot-story] could not start', err));
  return api;
}
