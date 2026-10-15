/*!
 * scroll-3d-hero.js
 * A 3D object pinned in a sticky stage that floats, revolves and travels as the
 * page scrolls: the "product flips through the hero and lands in a card" effect.
 *
 * Vanilla Three.js, no build step. The page needs an import map that resolves
 * "three" and "three/addons/" (see template.html), plus the stage CSS from SKILL.md.
 *
 *   import { createScroll3DHero } from './scroll-3d-hero.js';
 *   const hero = createScroll3DHero({ track: '.s3h', stage: '.s3h-stage', keyframes: [...] });
 *
 * Units used by keyframes (all relative, so one choreography works at any screen size):
 *   x, y    position of the object's centre: -1 = left/bottom edge, 0 = centre, 1 = right/top edge
 *   z       depth in world units (positive = towards the camera); usually leave at 0
 *   size    the object's largest dimension as a fraction of the viewport's shorter side
 *   rotate  [x, y, z] in degrees, interpolated per axis, so -360 means one full revolution
 *   shadow  0..1 opacity multiplier for the soft ground shadow
 *   clip, clipTime  scrub an animation clip with the scroll between keyframes (see ANIMATION_DEFAULTS)
 *
 * Animated models (an animal, a character): give the model an `animation` config and the runtime plays
 * its glTF clips, picking idle / walk / run from how fast the object travels and turning it to face
 * where it is going. See ANIMATION_DEFAULTS below.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DEG = Math.PI / 180;
const POSE_KEYS = ['x', 'y', 'z', 'size', 'rx', 'ry', 'rz', 'shadow'];
const POSE_DEFAULTS = { x: 0, y: 0, z: 0, size: 0.6, rx: 0, ry: 0, rz: 0, shadow: 0 };
const NESTED_OPTIONS = ['camera', 'idle', 'shadow', 'lighting'];

// For models with animation clips. Speeds are in body lengths per second (the model's longest side),
// or screens per second with drive: 'scroll'.
export const ANIMATION_DEFAULTS = {
  idle: 0, // clip name (or index) played at rest; a string config like animation: 'Walk' just loops that clip
  walk: null, // clip played while travelling slowly
  run: null, // clip played while travelling fast
  walkAbove: 0.08, // speed that switches idle -> walk
  runAbove: 1.4, // speed that switches walk -> run
  walkSpeed: 0.6, // speed at which the walk clip plays at its normal rate, so the feet keep up with the ground
  runSpeed: 2, // the same for the run clip
  fade: 0.3, // crossfade between clips, in seconds
  drive: 'motion', // 'motion' = how fast it travels across the screen; 'scroll' = how fast the page scrolls
  face: true, // turn to face the direction of travel; or { moving: 90, idle: 35, start: 1 } in degrees / ±1
  still: 'idle', // at rest: 'idle' plays the idle clip; 'pose' holds the idle clip's first frame (no motion);
  //               'freeze' keeps whatever pose it stopped in
};
// Scroll-scrubbed clips: between two keyframes that set the same `clip` and a `clipTime` (in cycles),
// that clip follows the scrollbar instead of the clock, e.g. a leap that freezes mid-air when the
// visitor stops scrolling:  { at: 0.2, clip: 'Run', clipTime: 0 }, { at: 0.4, clip: 'Run', clipTime: 1 }
const TONE_MAPPINGS = { neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, none: THREE.NoToneMapping };

export const easings = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - (1 - t) ** 3,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};

const DEFAULTS = {
  track: '.s3h', // element whose scroll range drives the animation (wraps hero + following sections)
  stage: '.s3h-stage', // sticky, viewport-sized element inside the track; the canvas goes here
  model: { shape: 'plate' }, // { shape: 'plate' | 'bowl', color } | { url: 'model.glb' } | { buffer: ArrayBuffer } | { object }
  //                            add animation: { idle: 'Idle', walk: 'Walk', run: 'Run' } to play a model's clips
  keyframes: [
    { at: 0, x: 0.5, y: -0.38, size: 1.15, rotate: [60, -30, 20] },
    { at: 0.5, x: -0.1, y: 0.05, size: 0.45, rotate: [-110, 15, -10] },
    { at: 1, x: 0, y: 0, size: 0.6, rotate: [-295, 0, 0] },
  ],
  responsive: {}, // { '(max-width: 767px)': { keyframes: [...], idle: {...} } }
  camera: { fov: 30, distance: 5 }, // a narrow fov gives the flat "product shot" look
  idle: { wobble: 3.5, speed: 0.5, float: 0.015 }, // degrees, radians/second, model-size units; false disables
  spin: 0, // degrees/second around the model's own up axis (the "turntable" revolve)
  tilt: 0, // degrees the object leans towards the pointer
  damping: 7, // how quickly the object catches up with the scrollbar; 0 = locked to it
  shadow: { opacity: 0.35, width: 0.9, offset: 0.42, color: '#1b1a17' },
  lighting: { environment: 0.6, key: 1.8, exposure: 1, toneMapping: 'neutral' }, // toneMapping: 'neutral' | 'aces' | 'agx'
  maxPixelRatio: 2,
  dracoPath: null, // defaults to the jsDelivr copy matching the loaded three.js revision
  debug: false, // or add ?s3h-debug to the URL
  onReady: null, // (hero) => {}
  onLoadProgress: null, // (fraction) => {} while a GLB downloads
  onUpdate: null, // (progress, pose) => {} every rendered frame
};

/* ------------------------------------------------------------------------ */

export function createScroll3DHero(userOptions = {}) {
  const base = mergeOptions(DEFAULTS, userOptions);
  // a walking animal shouldn't also sway like a floating product
  if (userOptions.idle === undefined && base.model && base.model.animation) base.idle = false;
  const track = resolveElement(base.track);
  const stage = resolveElement(base.stage);
  if (!track || !stage) {
    throw new Error(`[scroll-3d-hero] track "${base.track}" or stage "${base.stage}" not found`);
  }
  const debug = base.debug || new URLSearchParams(location.search).has('s3h-debug');
  checkLayout(stage, track);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    console.warn('[scroll-3d-hero] WebGL is unavailable; keeping the poster/fallback content.', err);
    stage.classList.add('s3h-fallback');
    return fallbackApi();
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 's3h-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTexture;

  const keyLight = new THREE.DirectionalLight(0xffffff, 2);
  keyLight.position.set(2.5, 4, 3);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
  rimLight.position.set(-4, 2, -3);
  scene.add(keyLight, rimLight);

  // root = keyframed pose, motion = idle wobble, heading = an animal turning to face its way,
  // swap = model-change transition, spinner = turntable spin
  const root = new THREE.Group();
  const motion = new THREE.Group();
  const heading = new THREE.Group();
  const swap = new THREE.Group();
  const spinner = new THREE.Group();
  root.add(motion);
  motion.add(heading);
  heading.add(swap);
  swap.add(spinner);
  scene.add(root);

  const shadow = createShadowMesh();
  scene.add(shadow);

  const clock = new THREE.Clock();
  const view = { w: 1, h: 1, visW: 1, visH: 1 };
  const pose = { ...POSE_DEFAULTS };
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const tweens = [];
  const tiltEuler = new THREE.Euler();
  const tiltQuat = new THREE.Quaternion();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const mediaQueries = Object.keys(base.responsive || {}).map((q) => matchMedia(q));

  const walker = { speed: 0, vx: 0, dir: 0, last: null, lastProgress: 0, snap: true, moved: false }; // animated models
  let opts = base;
  let frames = [];
  let tracks = {};
  let stageRect = stage.getBoundingClientRect();
  let target = 0;
  let smooth = 0;
  let firstFrame = true;
  let settled = false;
  let ready = false;
  let visible = false;
  let running = false;
  let destroyed = false;
  let current = null;
  let lastCssProgress = -1;
  let refreshQueued = false;
  let swapChain = Promise.resolve();
  let swapToken = 0;
  let gltfLoader = null;
  let debugEl = null;
  let debugStamp = 0;

  /* ---------- options, sizing and keyframes ---------- */

  function computeOptions() {
    let o = base;
    for (const [query, override] of Object.entries(base.responsive || {})) {
      if (matchMedia(query).matches) o = mergeOptions(o, override);
    }
    if (o.idle === false) o = { ...o, idle: { wobble: 0, speed: 0, float: 0 } };
    if (reducedMotion.matches) {
      o = { ...o, idle: { ...o.idle, wobble: 0, float: 0 }, spin: 0, tilt: 0, damping: 0 };
    }
    return o;
  }

  function refresh() {
    refreshQueued = false;
    if (destroyed) return;
    opts = computeOptions();
    renderer.toneMapping = TONE_MAPPINGS[opts.lighting.toneMapping] ?? THREE.NeutralToneMapping;
    renderer.toneMappingExposure = opts.lighting.exposure;
    scene.environmentIntensity = opts.lighting.environment;
    keyLight.intensity = opts.lighting.key;
    shadow.material.color.set(opts.shadow.color);
    resize();
    buildFrames();
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio));
    renderer.setSize(w, h, false);
    camera.fov = opts.camera.fov;
    camera.aspect = w / h;
    camera.position.set(0, 0, opts.camera.distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    view.w = w;
    view.h = h;
    view.visH = 2 * opts.camera.distance * Math.tan((opts.camera.fov * DEG) / 2);
    view.visW = view.visH * camera.aspect;
  }

  function buildFrames() {
    const list = opts.keyframes || [];
    const trackRect = track.getBoundingClientRect();
    const range = Math.max(1, trackRect.height - view.h);
    frames = list
      .map((kf, index) => {
        const frame = { index, ease: resolveEase(kf.ease), values: {}, anchorEl: null, live: null };
        frame.at = resolveAt(kf.at ?? index / Math.max(1, list.length - 1), trackRect, range);
        for (const k of ['x', 'y', 'z', 'size', 'shadow', 'rx', 'ry', 'rz']) {
          if (typeof kf[k] === 'number') frame.values[k] = kf[k];
        }
        if (Array.isArray(kf.rotate)) {
          kf.rotate.forEach((v, i) => {
            if (typeof v === 'number') frame.values[['rx', 'ry', 'rz'][i]] = v;
          });
        }
        if (typeof kf.clipTime === 'number') frame.values.clipTime = kf.clipTime;
        if (kf.clip) frame.values.clip = kf.clip;
        if (kf.anchor) {
          frame.anchorEl = resolveElement(kf.anchor);
          if (!frame.anchorEl) console.warn(`[scroll-3d-hero] anchor "${kf.anchor}" not found`);
          else if (debug) frame.anchorEl.style.outline = '1px dashed #f0f';
          frame.fit = typeof kf.fit === 'number' ? kf.fit : null;
          frame.offsetX = kf.x ?? 0; // with an anchor, x/y become offsets from the anchor's centre
          frame.offsetY = kf.y ?? 0;
        }
        return frame;
      })
      .sort((a, b) => a.at - b.at || a.index - b.index);
    tracks = {};
    for (const key of POSE_KEYS) tracks[key] = frames.filter((f) => hasValue(f, key));
    tracks.clipTime = frames.filter((f) => f.values.clipTime !== undefined);
  }

  function hasValue(frame, key) {
    if (frame.anchorEl && (key === 'x' || key === 'y')) return true;
    if (frame.anchorEl && key === 'size' && frame.fit !== null) return true;
    return frame.values[key] !== undefined;
  }

  function resolveAt(at, trackRect, range) {
    if (typeof at === 'number') return clamp01(at);
    const el = resolveElement(at);
    if (!el) {
      console.warn(`[scroll-3d-hero] keyframe "at" target "${at}" not found; using 0`);
      return 0;
    }
    // the progress at which this element's top edge reaches the top of the viewport
    return clamp01((el.getBoundingClientRect().top - trackRect.top) / range);
  }

  function updateAnchors() {
    for (const f of frames) {
      if (!f.anchorEl) continue;
      const r = f.anchorEl.getBoundingClientRect();
      const cx = r.left + r.width / 2 - stageRect.left;
      const cy = r.top + r.height / 2 - stageRect.top;
      f.live = {
        x: (cx / view.w) * 2 - 1 + f.offsetX,
        y: 1 - (cy / view.h) * 2 + f.offsetY,
        size: f.fit !== null ? (Math.min(r.width, r.height) / Math.min(view.w, view.h)) * f.fit : undefined,
      };
    }
  }

  function valueOf(frame, key) {
    if (frame.live && frame.live[key] !== undefined) return frame.live[key];
    return frame.values[key];
  }

  function sample(key, p) {
    const list = tracks[key];
    if (!list || !list.length) return POSE_DEFAULTS[key];
    if (p <= list[0].at) return valueOf(list[0], key);
    for (let i = 1; i < list.length; i++) {
      const b = list[i];
      if (p <= b.at) {
        const a = list[i - 1];
        const span = b.at - a.at;
        const t = span > 1e-6 ? (p - a.at) / span : 1;
        const va = valueOf(a, key);
        return va + (valueOf(b, key) - va) * b.ease(t);
      }
    }
    return valueOf(list[list.length - 1], key);
  }

  // The clip being scrubbed at progress p, if p lies between two keyframes that scrub the same clip.
  function sampleClip(p) {
    const list = tracks.clipTime || [];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (p >= a.at && p <= b.at && a.values.clip && a.values.clip === b.values.clip) {
        const span = b.at - a.at;
        const t = span > 1e-6 ? (p - a.at) / span : 1;
        return { clip: a.values.clip, cycles: a.values.clipTime + (b.values.clipTime - a.values.clipTime) * b.ease(t) };
      }
    }
    return null;
  }

  /* ---------- per-frame update ---------- */

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const time = clock.elapsedTime;

    const trackRect = track.getBoundingClientRect();
    stageRect = stage.getBoundingClientRect();
    const range = trackRect.height - view.h;
    target = range > 0 ? clamp01(-trackRect.top / range) : 0;
    if (firstFrame || opts.damping <= 0) {
      smooth = target;
      firstFrame = false;
    } else {
      smooth += (target - smooth) * (1 - Math.exp(-opts.damping * dt));
      if (Math.abs(target - smooth) < 1e-4) smooth = target;
    }

    updateAnchors();
    for (const key of POSE_KEYS) pose[key] = sample(key, smooth);
    applyPose(time, dt);
    updateWalker(dt);
    runTweens(time);
    renderer.render(scene, camera);

    if (Math.abs(smooth - lastCssProgress) > 0.0005 || (smooth !== lastCssProgress && (smooth === 0 || smooth === 1))) {
      track.style.setProperty('--s3h-progress', smooth.toFixed(4));
      lastCssProgress = smooth;
    }
    const nowSettled = smooth === target && tweens.length === 0;
    if (nowSettled !== settled) {
      settled = nowSettled;
      stage.dataset.s3hSettled = String(settled);
    }
    if (opts.onUpdate) opts.onUpdate(smooth, pose);
    if (debugEl && time - debugStamp > 0.1) {
      debugStamp = time;
      renderDebug();
    }
  }

  function applyPose(time, dt) {
    const worldSize = Math.max(pose.size * Math.min(view.visW, view.visH), 1e-4);
    root.position.set((pose.x * view.visW) / 2, (pose.y * view.visH) / 2, pose.z);
    root.rotation.set(pose.rx * DEG, pose.ry * DEG, pose.rz * DEG);
    root.scale.setScalar(worldSize);

    if (opts.tilt) {
      const k = 1 - Math.exp(-4 * dt);
      pointer.sx += (pointer.x - pointer.sx) * k;
      pointer.sy += (pointer.y - pointer.sy) * k;
      // lean in screen space, independent of how the keyframes have rotated the object
      tiltQuat.setFromEuler(tiltEuler.set(pointer.sy * opts.tilt * DEG, pointer.sx * opts.tilt * DEG, 0));
      root.quaternion.premultiply(tiltQuat);
    }

    const { wobble = 0, speed = 0, float = 0 } = opts.idle || {};
    motion.rotation.x = wobble * DEG * Math.cos(time * speed);
    motion.rotation.y = wobble * DEG * Math.sin(time * speed);
    motion.position.y = float * Math.sin(time * speed * 1.7);
    if (opts.spin) spinner.rotation.y += opts.spin * DEG * dt;

    const so = opts.shadow;
    const opacity = pose.shadow * so.opacity;
    shadow.visible = opacity > 0.002;
    if (shadow.visible) {
      shadow.material.opacity = opacity;
      shadow.position.set(root.position.x, root.position.y - worldSize * so.offset, root.position.z);
      shadow.scale.set(worldSize * so.width, worldSize * so.width * 0.28, 1);
    }
  }

  // Drive an animated model: measure how fast it travels, pick idle/walk/run, and face the way it goes.
  function updateWalker(dt) {
    const anim = current && current.userData.anim;
    if (!anim) return;
    const size = root.scale.x;
    const conf = anim.conf;
    let speed = 0;
    let vx = 0;
    if (walker.last && dt > 1e-4) {
      if (conf.drive === 'scroll') {
        const trackHeight = track.getBoundingClientRect().height;
        vx = (((smooth - walker.lastProgress) / dt) * Math.max(0, trackHeight - view.h)) / view.h; // screens/s
        speed = Math.abs(vx);
      } else {
        vx = (root.position.x - walker.last.x) / dt / size; // body lengths per second
        speed = Math.hypot(vx, (root.position.y - walker.last.y) / dt / size);
      }
    }
    walker.last = { x: root.position.x, y: root.position.y };
    walker.lastProgress = smooth;
    const k = 1 - Math.exp(-dt / 0.15);
    walker.speed += (speed - walker.speed) * k;
    walker.vx += (vx - walker.vx) * k;
    const scrub = sampleClip(smooth);
    anim.update(dt, walker.speed, reducedMotion.matches, scrub);

    if (conf.face) {
      const face = { moving: 90, idle: 35, start: 1, ...(conf.face === true ? {} : conf.face) };
      if (!walker.dir) walker.dir = face.start;
      if (Math.abs(walker.vx) > conf.walkAbove * 0.5) walker.dir = Math.sign(walker.vx);
      if (anim.state !== 'idle') walker.moved = true;
      // with still: 'pose' or 'freeze' it stays turned the way it stopped, so nothing moves at rest
      const atRest = anim.state === 'idle' && (conf.still === 'idle' || !walker.moved);
      const yaw = walker.dir * (atRest ? face.idle : face.moving) * DEG;
      if (walker.snap) {
        heading.rotation.y = yaw; // a freshly shown model starts already facing the right way
        walker.snap = false;
      } else {
        heading.rotation.y += (yaw - heading.rotation.y) * (1 - Math.exp(-dt * 5));
      }
    }
  }

  function tween(duration, ease, apply) {
    return new Promise((resolve) => tweens.push({ start: null, duration, ease, apply, resolve }));
  }

  function runTweens(time) {
    for (let i = 0; i < tweens.length; i++) {
      const tw = tweens[i];
      if (tw.start === null) tw.start = time;
      const k = Math.min(1, (time - tw.start) / tw.duration);
      tw.apply(tw.ease(k));
      if (k >= 1) {
        tweens.splice(i--, 1);
        tw.resolve();
      }
    }
  }

  /* ---------- models ---------- */

  function getLoader() {
    if (!gltfLoader) {
      const draco = new DRACOLoader().setDecoderPath(
        base.dracoPath || `https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}.0/examples/jsm/libs/draco/gltf/`
      );
      gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    }
    return gltfLoader;
  }

  async function loadModel(source) {
    const src = typeof source === 'string' ? { url: source } : source || {};
    let object;
    let clips = src.animations || [];
    if (src.object) {
      object = src.object;
    } else if (src.url || src.buffer) {
      const gltf = src.buffer
        ? await getLoader().parseAsync(src.buffer instanceof ArrayBuffer ? src.buffer : src.buffer.buffer, '')
        : await getLoader().loadAsync(src.url, (e) => {
            if (e.total && base.onLoadProgress) base.onLoadProgress(e.loaded / e.total);
          });
      object = gltf.scene;
      clips = gltf.animations || [];
    } else {
      object = buildShape(src);
    }
    if (typeof src.prepare === 'function') src.prepare(object);
    // skinned meshes are culled by their rest pose; a walking animal must never blink out
    object.traverse((node) => {
      if (node.isSkinnedMesh) node.frustumCulled = false;
    });
    const holder = normalizeObject(object, src.rotate);
    if (src.animation && clips.length) holder.userData.anim = createAnimator(object, clips, src.animation);
    else if (src.animation) console.warn('[scroll-3d-hero] model.animation is set but the model has no animation clips');
    return holder;
  }

  // Swap the displayed object. With a previous model on screen it revolves out and the new one revolves in.
  function setModel(source, { direction = 1 } = {}) {
    const token = ++swapToken;
    const loading = loadModel(source);
    loading.catch(() => {}); // the rejection is surfaced through `run` below
    const run = swapChain.then(async () => {
      const next = await loading;
      if (destroyed || token !== swapToken) {
        disposeObject(next);
        return;
      }
      const animate = current && running && !reducedMotion.matches;
      if (animate) {
        await tween(0.45, easings.easeIn, (k) => {
          swap.scale.setScalar(Math.max(1 - k, 1e-4));
          swap.rotation.y = k * Math.PI * direction;
        });
      }
      if (current) {
        spinner.remove(current);
        current.userData.anim?.dispose();
        disposeObject(current);
      }
      current = next;
      spinner.add(next);
      walker.last = null;
      walker.snap = true;
      walker.moved = false;
      if (animate) {
        await tween(0.6, easings.easeOut, (k) => {
          swap.scale.setScalar(Math.max(k, 1e-4));
          swap.rotation.y = (k - 1) * Math.PI * direction;
        });
      } else {
        swap.scale.setScalar(1);
        swap.rotation.y = 0;
      }
    });
    swapChain = run.catch(() => {});
    return run;
  }

  /* ---------- lifecycle ---------- */

  function updateLoop() {
    const shouldRun = visible && ready && !destroyed;
    if (shouldRun === running) return;
    running = shouldRun;
    if (running) {
      clock.getDelta();
      firstFrame = true;
      walker.last = null;
      renderer.setAnimationLoop(frame);
    } else {
      renderer.setAnimationLoop(null);
    }
  }

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      updateLoop();
    },
    { rootMargin: '200px 0px' }
  );
  io.observe(track);

  const ro = new ResizeObserver(scheduleRefresh);
  ro.observe(stage);
  ro.observe(track);

  const onPointer = (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('load', scheduleRefresh);
  document.fonts?.ready.then(scheduleRefresh);
  reducedMotion.addEventListener('change', scheduleRefresh);
  mediaQueries.forEach((mq) => mq.addEventListener('change', scheduleRefresh));

  if (debug) {
    debugEl = document.createElement('div');
    debugEl.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none;white-space:pre;' +
      'font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#fff;background:rgba(0,0,0,.78);padding:8px 10px;border-radius:8px';
    document.body.appendChild(debugEl);
  }

  function renderDebug() {
    const f = (n) => (Math.round(n * 1000) / 1000).toString();
    debugEl.textContent =
      `scroll-3d-hero  progress ${f(smooth)} (target ${f(target)})\n` +
      `x ${f(pose.x)}  y ${f(pose.y)}  z ${f(pose.z)}  size ${f(pose.size)}  shadow ${f(pose.shadow)}\n` +
      `rotate [${Math.round(pose.rx)}, ${Math.round(pose.ry)}, ${Math.round(pose.rz)}]\n` +
      `keyframes at ${frames.map((fr) => f(fr.at)).join(' · ')}` +
      (current && current.userData.anim
        ? `\nanimation ${current.userData.anim.state}${current.userData.anim.state === 'scrub' ? ' ' + current.userData.anim.scrubbing : ''}  speed ${f(walker.speed)}  facing ${walker.dir < 0 ? 'left' : 'right'}`
        : '');
  }

  function destroy() {
    destroyed = true;
    renderer.setAnimationLoop(null);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('load', scheduleRefresh);
    reducedMotion.removeEventListener('change', scheduleRefresh);
    mediaQueries.forEach((mq) => mq.removeEventListener('change', scheduleRefresh));
    current?.userData.anim?.dispose();
    disposeObject(scene);
    envTexture.dispose();
    renderer.dispose();
    canvas.remove();
    debugEl?.remove();
    stage.classList.remove('is-ready');
    delete stage.dataset.s3hReady;
    delete stage.dataset.s3hSettled;
  }

  const api = {
    get progress() {
      return smooth;
    },
    get settled() {
      return settled;
    },
    get model() {
      return current;
    },
    scene,
    camera,
    renderer,
    setModel,
    // names of the current model's animation clips
    get clips() {
      return current?.userData.anim?.clips || [];
    },
    // force a clip (e.g. on click); playClip(null) hands control back to the automatic gait
    playClip(name) {
      current?.userData.anim?.play(name);
    },
    setKeyframes(keyframes) {
      base.keyframes = keyframes;
      refresh();
    },
    refresh,
    destroy,
    ready: null,
  };

  refresh();
  api.ready = setModel(base.model).then(
    () => {
      if (destroyed) return api;
      ready = true;
      stage.classList.add('is-ready');
      stage.dataset.s3hReady = 'true';
      updateLoop();
      if (base.onReady) base.onReady(api);
      stage.dispatchEvent(new CustomEvent('s3h:ready', { detail: api }));
      return api;
    },
    (err) => {
      console.error('[scroll-3d-hero] could not load the model', err);
      stage.classList.add('s3h-error');
      throw err;
    }
  );
  api.ready.catch(() => {});
  return api;
}

/* ------------------------------------------------------------------------ */
/* Animation: plays a model's glTF clips and crossfades between idle, walk   */
/* and run based on how fast the object is travelling.                       */

export function createAnimator(root, clips, config) {
  const conf = { ...ANIMATION_DEFAULTS, ...(typeof config === 'string' ? { idle: config } : config) };
  const find = (ref) =>
    ref === null || ref === undefined
      ? null
      : typeof ref === 'number'
        ? clips[ref] || null
        : THREE.AnimationClip.findByName(clips, ref);
  const names = clips.map((c) => c.name);
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const state of ['idle', 'walk', 'run']) {
    const clip = find(conf[state]);
    if (conf[state] !== null && conf[state] !== undefined && !clip) {
      console.warn(`[scroll-3d-hero] animation clip "${conf[state]}" not found; this model has: ${names.join(', ')}`);
    }
    if (clip) actions[state] = mixer.clipAction(clip);
  }
  if (!actions.idle) actions.idle = mixer.clipAction(clips[0]);

  let active = null;
  let state = 'idle';
  let manual = null;
  let scrubbing = '';
  const warned = new Set();
  const crossTo = (action) => {
    if (action === active) return;
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (active) active.crossFadeTo(action, conf.fade, false);
    active = action;
  };
  crossTo(actions.idle);

  return {
    conf,
    clips: names,
    get state() {
      return manual ? 'manual' : state;
    },
    get scrubbing() {
      return scrubbing;
    },
    update(dt, speed, stayIdle, scrub) {
      const scrubClip = scrub && !manual ? find(scrub.clip) : null;
      if (scrub && !scrubClip && !warned.has(scrub.clip)) {
        warned.add(scrub.clip);
        console.warn(`[scroll-3d-hero] animation clip "${scrub.clip}" not found; this model has: ${names.join(', ')}`);
      }
      if (scrubClip) {
        // the scrollbar sets the clip's time; mixer time only advances the crossfade weights
        state = 'scrub';
        scrubbing = scrub.clip;
        const action = mixer.clipAction(scrubClip);
        crossTo(action);
        action.setEffectiveTimeScale(0);
        action.time = (((scrub.cycles % 1) + 1) % 1) * scrubClip.duration;
      } else if (manual) {
        crossTo(manual);
      } else {
        // leaving a state takes a little less speed than entering it, so the gait doesn't flicker
        const walkOn = conf.walkAbove * (state === 'idle' ? 1 : 0.7);
        const runOn = conf.runAbove * (state === 'run' ? 0.8 : 1);
        state = stayIdle ? 'idle' : actions.run && speed > runOn ? 'run' : actions.walk && speed > walkOn ? 'walk' : 'idle';
        if (state === 'idle' && conf.still === 'freeze' && active) {
          active.setEffectiveTimeScale(0); // hold the exact pose it stopped in
        } else {
          crossTo(actions[state]);
          if (state === 'idle' && conf.still === 'pose') active.setEffectiveTimeScale(0); // first frame, held
        }
        if (state === 'walk') active.setEffectiveTimeScale(Math.min(1.8, Math.max(0.5, speed / conf.walkSpeed)));
        if (state === 'run') active.setEffectiveTimeScale(Math.min(1.8, Math.max(0.6, speed / conf.runSpeed)));
      }
      mixer.update(dt);
    },
    play(name) {
      if (name === null || name === undefined) {
        manual = null;
        return;
      }
      const clip = find(name);
      if (!clip) console.warn(`[scroll-3d-hero] animation clip "${name}" not found; this model has: ${names.join(', ')}`);
      else manual = mixer.clipAction(clip);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Procedural shapes: a molded-fibre plate and bowl, so the effect works     */
/* before anyone has a real product model.                                   */

const SHAPES = {
  // [radius, height] profile, diameter 1, traced bottom centre -> rim -> top centre
  plate: {
    points: [
      [0, 0], [0.3, 0], [0.36, 0.012], [0.42, 0.045], [0.47, 0.07], [0.5, 0.079],
      [0.506, 0.086], [0.499, 0.092],
      [0.465, 0.084], [0.413, 0.059], [0.353, 0.027], [0.3, 0.014], [0, 0.014],
    ],
    ribStart: 0.37,
    ribs: 44,
    ribDepth: 0.005,
  },
  bowl: {
    points: [
      [0, 0], [0.19, 0], [0.29, 0.03], [0.39, 0.12], [0.455, 0.25], [0.49, 0.36], [0.5, 0.385],
      [0.497, 0.398], [0.481, 0.384],
      [0.449, 0.262], [0.387, 0.143], [0.288, 0.052], [0.19, 0.022], [0, 0.022],
    ],
    ribStart: 0.3,
    ribs: 36,
    ribDepth: 0.006,
  },
};

function buildShape({ shape = 'plate', color = '#ece4d4', roughness = 0.88, ribs, ribDepth, texture = true } = {}) {
  const def = SHAPES[shape];
  if (!def) throw new Error(`[scroll-3d-hero] unknown shape "${shape}"; use "plate" or "bowl", or pass { url } / { object }`);
  const geometry = latheShape(def, ribs ?? def.ribs, ribDepth ?? def.ribDepth);
  const map = texture ? fibreTexture() : null;
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, map, bumpMap: map, bumpScale: 1.2 });
  return new THREE.Mesh(geometry, material);
}

function latheShape({ points, ribStart }, ribs, ribDepth, segments = 176) {
  let profile = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(140);
  profile.forEach((p) => (p.x = Math.max(0, p.x)));
  profile[0].x = 0;
  profile[profile.length - 1].x = 0;

  const build = (prof) => {
    const geo = new THREE.LatheGeometry(prof, segments);
    const pos = geo.attributes.position;
    if (ribs > 0 && ribDepth > 0) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const r = Math.hypot(x, z);
        if (r < ribStart) continue;
        const w = smoothstep(ribStart, ribStart + 0.05, r);
        const k = 1 + (ribDepth * w * Math.cos(ribs * Math.atan2(z, x))) / r;
        pos.setX(i, x * k);
        pos.setZ(i, z * k);
      }
    }
    geo.computeVertexNormals();
    stitchSeamNormals(geo, prof.length, segments);
    return geo;
  };

  let geo = build(profile);
  if (!topFacesUp(geo)) {
    geo.dispose();
    profile = profile.slice().reverse();
    geo = build(profile);
  }
  return geo;
}

// LatheGeometry duplicates the first meridian at 360°; average their normals so the seam disappears.
function stitchSeamNormals(geo, pointsPerMeridian, segments) {
  const n = geo.attributes.normal;
  for (let j = 0; j < pointsPerMeridian; j++) {
    const a = j;
    const b = segments * pointsPerMeridian + j;
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const len = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / len, y / len, z / len);
    n.setXYZ(b, x / len, y / len, z / len);
  }
}

// The highest vertex near the axis lies on the top surface; its normal must point up.
function topFacesUp(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  let best = -1;
  let bestY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    if (r > 0.02 && r < 0.12 && pos.getY(i) > bestY) {
      bestY = pos.getY(i);
      best = i;
    }
  }
  return best < 0 || nor.getY(best) > 0;
}

let sharedFibreTexture = null;
function fibreTexture() {
  if (sharedFibreTexture) return sharedFibreTexture;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#f4f3f0';
  g.fillRect(0, 0, size, size);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tiled = (x, y, pad, draw) => {
    // repeat marks near an edge on the opposite side so the texture tiles without seams
    const xs = x < pad ? [x, x + size] : x > size - pad ? [x, x - size] : [x];
    const ys = y < pad ? [y, y + size] : y > size - pad ? [y, y - size] : [y];
    for (const px of xs) for (const py of ys) draw(px, py);
  };
  for (let i = 0; i < 6500; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 2 + rnd() * 9;
    const a = rnd() * Math.PI * 2;
    const v = Math.round(196 + rnd() * 59);
    g.strokeStyle = `rgba(${v},${v},${v - 8},${0.3 + rnd() * 0.45})`;
    g.lineWidth = 0.5 + rnd() * 0.9;
    tiled(x, y, 12, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      g.stroke();
    });
  }
  for (let i = 0; i < 1100; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const v = Math.round(150 + rnd() * 50);
    g.fillStyle = `rgba(${v},${v - 10},${v - 24},${0.2 + rnd() * 0.35})`;
    const r = 0.4 + rnd() * 1.1;
    tiled(x, y, 3, (px, py) => {
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  tex.anisotropy = 4;
  sharedFibreTexture = tex;
  return tex;
}

/* ------------------------------------------------------------------------ */

function createShadowMesh() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const material = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    opacity: 0,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = -1;
  mesh.visible = false;
  return mesh;
}

// Centre the object and scale it so its largest dimension is 1; keyframe `size` then means the same for any model.
export function normalizeObject(object, rotate) {
  if (Array.isArray(rotate)) object.rotation.set(...rotate.map((d) => (d || 0) * DEG));
  const holder = new THREE.Group();
  holder.add(object);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object, true);
  if (box.isEmpty()) return holder;
  const size = box.getSize(new THREE.Vector3());
  object.position.sub(box.getCenter(new THREE.Vector3()));
  holder.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
  return holder;
}

function disposeObject(object) {
  object.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const m of materials) {
      for (const value of Object.values(m)) {
        if (value && value.isTexture && value !== sharedFibreTexture) value.dispose();
      }
      m.dispose();
    }
  });
}

function checkLayout(stage, track) {
  const warn = (msg) => console.warn(`[scroll-3d-hero] ${msg}`);
  if (!track.contains(stage)) warn('the stage must be inside the track element.');
  const position = getComputedStyle(stage).position;
  if (position !== 'sticky' && position !== 'fixed') {
    warn(`the stage is position: ${position}; it needs position: sticky (see SKILL.md) or the object scrolls away.`);
  }
  if (!stage.clientHeight) warn('the stage has no height; give it height: 100vh.');
  const html = getComputedStyle(document.documentElement);
  const htmlVisible = html.overflowX === 'visible' && html.overflowY === 'visible';
  for (let el = stage.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    if (el === document.body && htmlVisible) continue; // body overflow propagates to the viewport
    const s = getComputedStyle(el);
    if (/hidden|auto|scroll/.test(`${s.overflowX} ${s.overflowY}`)) {
      warn(
        `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}> has overflow ${s.overflowX}/${s.overflowY}, ` +
          'which stops position: sticky from pinning the stage. Use overflow: clip instead.'
      );
      break;
    }
  }
}

function fallbackApi() {
  const noop = () => {};
  const ready = Promise.reject(new Error('WebGL unavailable'));
  ready.catch(noop);
  return {
    progress: 0,
    settled: true,
    model: null,
    setModel: () => Promise.resolve(),
    setKeyframes: noop,
    refresh: noop,
    destroy: noop,
    ready,
  };
}

function mergeOptions(base, override = {}) {
  const out = { ...base, ...override };
  for (const key of NESTED_OPTIONS) {
    if (override[key] && typeof override[key] === 'object' && base[key] && typeof base[key] === 'object') {
      out[key] = { ...base[key], ...override[key] };
    }
  }
  return out;
}

function resolveElement(target) {
  if (!target) return null;
  return typeof target === 'string' ? document.querySelector(target) : target;
}

function resolveEase(ease) {
  if (typeof ease === 'function') return ease;
  return easings[ease] || easings.easeInOut;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
