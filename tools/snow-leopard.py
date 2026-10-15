#!/usr/bin/env python3
"""Build site/models/snow-leopard.glb: an original, rigged, low-poly snow leopard for the dot story.

Everything here is generated, so the model is ours to use without credit:
  - the body is a smooth union of rounded shapes (stocky body, deep chest, small round head and ears,
    short muzzle, big paws and the long, thick tail), meshed with marching cubes and simplified;
  - the coat is painted into the vertex colours: pale fur, a whiter belly, rosettes on the body and
    tail, solid spots on the head and legs, a dark tail tip; the dots dither those markings;
  - a skeleton (pelvis, spine, chest, neck, head, nine tail bones, three or four bones a leg) with
    weights from each vertex's distance to the bones;
  - two clips: "Stand" (its first frame is the pose it holds on a word) and "Leap" (one bound: gather,
    push off, full stretch, reach, land), which the page scrubs with the scroll.

It faces +Z with Y up, in metres. Run:  python3 site/tools/snow-leopard.py site/models/snow-leopard.glb
Needs numpy, scikit-image and pyfqmr (pip install numpy scikit-image pyfqmr).
"""
import json
import math
import struct
import sys

import numpy as np
import pyfqmr
from skimage.measure import marching_cubes

RNG = np.random.default_rng(7)

# ---------------------------------------------------------------- skeleton (bind pose: standing)

SIDES = (('L', 1), ('R', -1))
# the tail in its resting curve: down from the base, along the ground, the tip curling up (as in the logo)
TAIL = [(0, 0.54, -0.48), (0, 0.49, -0.61), (0, 0.42, -0.73), (0, 0.34, -0.84), (0, 0.26, -0.94),
        (0, 0.20, -1.05), (0, 0.17, -1.17), (0, 0.19, -1.29), (0, 0.25, -1.38), (0, 0.32, -1.42)]

BONES = [  # name, parent, head (world, bind pose), end (where its segment ends, for the weights)
    ('pelvis', None, (0, 0.52, -0.30), (0, 0.54, -0.05)),
    ('spine', 'pelvis', (0, 0.54, -0.05), (0, 0.53, 0.20)),
    ('chest', 'spine', (0, 0.53, 0.20), (0, 0.56, 0.34)),
    ('neck', 'chest', (0, 0.56, 0.34), (0, 0.66, 0.47)),
    ('head', 'neck', (0, 0.66, 0.47), (0, 0.63, 0.64)),
]
for i in range(9):
    BONES.append((f'tail{i + 1}', 'pelvis' if i == 0 else f'tail{i}', TAIL[i], TAIL[i + 1]))
for s, x in SIDES:
    X = 0.095 * x
    BONES += [
        (f'upperarm.{s}', 'chest', (X, 0.46, 0.22), (X, 0.28, 0.19)),
        (f'forearm.{s}', f'upperarm.{s}', (X, 0.28, 0.19), (X, 0.08, 0.22)),
        (f'frontpaw.{s}', f'forearm.{s}', (X, 0.08, 0.22), (X, 0.025, 0.31)),
        (f'thigh.{s}', 'pelvis', (X, 0.49, -0.34), (X, 0.30, -0.25)),
        (f'shin.{s}', f'thigh.{s}', (X, 0.30, -0.25), (X, 0.15, -0.41)),
        (f'hock.{s}', f'shin.{s}', (X, 0.15, -0.41), (X, 0.055, -0.39)),
        (f'hindpaw.{s}', f'hock.{s}', (X, 0.055, -0.39), (X, 0.025, -0.30)),
    ]
NAMES = [b[0] for b in BONES]
INDEX = {n: i for i, n in enumerate(NAMES)}
HEAD = np.array([b[2] for b in BONES], float)
END = np.array([b[3] for b in BONES], float)

# ---------------------------------------------------------------- body: a smooth union of shapes


def ellipsoid(p, c, r):
    q = (p - np.array(c)) / np.array(r)
    return (np.linalg.norm(q, axis=-1) - 1) * min(r)


def capsule(p, a, b, ra, rb):
    a = np.array(a, float)
    ba = np.array(b, float) - a
    t = np.clip(((p - a) @ ba) / (ba @ ba), 0, 1)
    return np.linalg.norm(p - a - t[:, None] * ba, axis=-1) - (ra + (rb - ra) * t)


def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k / 4


def body(p):
    parts = [
        (ellipsoid(p, (0, 0.52, -0.32), (0.14, 0.16, 0.18)), 0.07),  # haunches
        (ellipsoid(p, (0, 0.505, -0.06), (0.145, 0.155, 0.26)), 0.07),  # belly
        (ellipsoid(p, (0, 0.50, 0.19), (0.14, 0.185, 0.17)), 0.07),  # deep chest
        (capsule(p, (0, 0.55, 0.27), (0, 0.64, 0.44), 0.11, 0.085), 0.06),  # neck
        (ellipsoid(p, (0, 0.665, 0.50), (0.098, 0.092, 0.10)), 0.04),  # skull
        (ellipsoid(p, (0, 0.632, 0.59), (0.062, 0.055, 0.062)), 0.03),  # muzzle
        (ellipsoid(p, (0, 0.606, 0.565), (0.045, 0.033, 0.05)), 0.02),  # chin
    ]
    for _, x in SIDES:
        X = 0.095 * x
        parts += [
            (ellipsoid(p, (0.07 * x, 0.56, 0.22), (0.07, 0.09, 0.11)), 0.05),  # shoulder blade
            (ellipsoid(p, (0.085 * x, 0.48, -0.33), (0.075, 0.14, 0.14)), 0.05),  # haunch
            (ellipsoid(p, (0.05 * x, 0.642, 0.535), (0.058, 0.052, 0.058)), 0.03),  # cheek
            (ellipsoid(p, (0.06 * x, 0.745, 0.475), (0.032, 0.034, 0.017)), 0.02),  # ear
            (capsule(p, (X, 0.46, 0.22), (X, 0.28, 0.19), 0.078, 0.058), 0.05),  # upper arm
            (capsule(p, (X, 0.28, 0.19), (X, 0.08, 0.22), 0.055, 0.047), 0.03),  # forearm
            (ellipsoid(p, (X, 0.038, 0.28), (0.058, 0.04, 0.075)), 0.03),  # front paw
            (capsule(p, (X, 0.49, -0.34), (X, 0.30, -0.25), 0.095, 0.066), 0.05),  # thigh
            (capsule(p, (X, 0.30, -0.25), (X, 0.15, -0.41), 0.062, 0.046), 0.03),  # shin
            (capsule(p, (X, 0.15, -0.41), (X, 0.055, -0.39), 0.045, 0.042), 0.03),  # hock
            (ellipsoid(p, (X, 0.035, -0.35), (0.055, 0.037, 0.072)), 0.03),  # hind paw
        ]
    for i in range(len(TAIL) - 1):  # the long, thick tail
        r0 = 0.078 - 0.01 * i / 9
        parts.append((capsule(p, TAIL[i], TAIL[i + 1], r0, r0 - 0.001), 0.03))
    d = parts[0][0]
    for v, k in parts[1:]:
        d = smin(d, v, k)
    return d


def build_mesh(voxel=0.008, faces=9000):
    lo = np.array([-0.27, -0.03, -1.55])
    hi = np.array([0.27, 0.86, 0.72])
    n = np.ceil((hi - lo) / voxel).astype(int) + 1
    axes = [lo[i] + np.arange(n[i]) * voxel for i in range(3)]
    grid = np.stack(np.meshgrid(*axes, indexing='ij'), -1).reshape(-1, 3)
    vol = body(grid).reshape(n)
    verts, tris, _, _ = marching_cubes(vol, 0.0, spacing=(voxel,) * 3)
    verts += lo
    s = pyfqmr.Simplify()
    s.setMesh(verts, tris)
    s.simplify_mesh(target_count=faces, aggressiveness=7, preserve_border=True, verbose=False)
    verts, tris, _ = s.getMesh()
    verts = verts.astype(float)
    tris = tris.astype(np.int64)
    # outward winding
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    if np.einsum('ij,ij->i', a, np.cross(b, c)).sum() < 0:
        tris = tris[:, ::-1].copy()
    return verts, tris


def vertex_normals(v, t):
    fn = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, t[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)

# ---------------------------------------------------------------- weights


def seg_dist(p, a, b):
    ba = b - a
    t = np.clip(((p - a) @ ba) / max(ba @ ba, 1e-9), 0, 1)
    return np.linalg.norm(p - a - t[:, None] * ba, axis=-1)


def skin_weights(v):
    d = np.stack([seg_dist(v, HEAD[i], END[i]) for i in range(len(BONES))], 1)
    # keep a leg's skin on its own side, and the tail's off the haunches
    for i, name in enumerate(NAMES):
        if name.endswith('.L'):
            d[v[:, 0] < -0.02, i] += 1
        if name.endswith('.R'):
            d[v[:, 0] > 0.02, i] += 1
    order = np.argsort(d, 1)[:, :4]
    dd = np.take_along_axis(d, order, 1)
    w = 1 / np.maximum(dd, 0.004) ** 4
    w /= w.sum(1, keepdims=True)
    q = np.round(w * 255).astype(int)
    q[:, 0] += 255 - q.sum(1)  # sums to exactly 255
    return order.astype(np.uint8), q.astype(np.uint8)

# ---------------------------------------------------------------- coat


def poisson(points, spacing, count):
    picks = []
    for i in RNG.permutation(len(points)):
        p = points[i]
        if all(np.linalg.norm(p - q) > spacing for q in picks):
            picks.append(p)
            if len(picks) >= count:
                break
    return np.array(picks)


def srgb_to_linear(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def coat(v, n):
    pale = np.array([0.87, 0.89, 0.89])
    belly = np.array([0.97, 0.97, 0.96])
    back = np.array([0.74, 0.77, 0.79])
    ink = np.array([0.16, 0.20, 0.22])
    col = np.tile(pale, (len(v), 1))
    up = n[:, 1]
    torso = (v[:, 2] > -0.5) & (v[:, 2] < 0.4) & (v[:, 1] > 0.3)
    col[torso & (up < -0.35)] = belly
    col[(up > 0.55) & (v[:, 1] > 0.52)] = back * 0.6 + pale * 0.4
    dark = np.zeros(len(v))

    head = v[:, 2] > 0.38
    legs = v[:, 1] < 0.33
    tail = v[:, 2] < -0.48
    rest = ~(head | legs | tail)
    # rosettes on the body and tail: a broken ring of four blobs round a slightly darker centre
    for region, spacing in ((rest, 0.105), (tail & (v[:, 2] > -1.3), 0.1)):
        idx = np.nonzero(region)[0]
        centres = poisson(v[idx], spacing, 400)
        for c in centres:
            r = 0.036 + RNG.random() * 0.01
            # two axes across the surface at c
            nn = n[idx][np.argmin(np.linalg.norm(v[idx] - c, axis=1))]
            t1 = np.cross(nn, [0, 1, 0] if abs(nn[1]) < 0.9 else [1, 0, 0])
            t1 /= np.linalg.norm(t1)
            t2 = np.cross(nn, t1)
            phase = RNG.random() * math.tau
            for k in range(4):
                a = phase + k * math.tau / 4 + RNG.normal(0, 0.3)
                blob = c + (t1 * math.cos(a) + t2 * math.sin(a)) * r
                dd = np.linalg.norm(v - blob, axis=1)
                dark = np.maximum(dark, np.clip(1 - dd / (0.022 + RNG.random() * 0.006), 0, 1) * 1.8)
            dd = np.linalg.norm(v - c, axis=1)
            dark = np.maximum(dark, np.clip(1 - dd / 0.02, 0, 1) * 0.35)
    # solid spots on the head and legs
    for region, spacing, size in ((head, 0.045, 0.017), (legs, 0.065, 0.021)):
        idx = np.nonzero(region)[0]
        for c in poisson(v[idx], spacing, 300):
            dd = np.linalg.norm(v - c, axis=1)
            dark = np.maximum(dark, np.clip(1 - dd / (size * (0.8 + RNG.random() * 0.5)), 0, 1) * 1.8)
    # dark tail tip, nose, the backs of the ears
    dark = np.maximum(dark, np.clip((-1.30 - v[:, 2]) / 0.04, 0, 1) * (v[:, 1] > 0.12))
    dark = np.maximum(dark, np.clip(1 - np.linalg.norm(v - [0, 0.648, 0.648], axis=1) / 0.025, 0, 1) * 2)
    ears = (v[:, 1] > 0.73) & (v[:, 2] < 0.475)
    dark[ears] = 1
    dark = np.clip(dark, 0, 1)
    col = col * (1 - dark[:, None]) + ink * dark[:, None]
    lin = srgb_to_linear(col)
    return np.round(np.concatenate([lin, np.ones((len(v), 1))], 1) * 255).astype(np.uint8)

# ---------------------------------------------------------------- poses and clips


def quat_from_euler(x, y, z):
    """Degrees; the rotation is Rz @ Ry @ Rx (pitch first)."""
    x, y, z = (math.radians(a) / 2 for a in (x, y, z))
    qx = np.array([math.sin(x), 0, 0, math.cos(x)])
    qy = np.array([0, math.sin(y), 0, math.cos(y)])
    qz = np.array([0, 0, math.sin(z), math.cos(z)])
    return qmul(qz, qmul(qy, qx))


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz])


def both(pose, **legs):
    for k, v in legs.items():
        for s, _ in SIDES:
            pose[f'{k}.{s}'] = v
    return pose


def tail(pose, base, rest, tip=None):
    pose['tail1'] = base
    for i in range(2, 10):
        pose[f'tail{i}'] = tip if (tip is not None and i >= 7) else rest
    return pose


# Rotations in degrees about X (pitch) unless a tuple. A leg bone hangs down, so + swings it back,
# - swings it forward; the spine, neck and head point forward, so + tips them down; the tail points
# backwards, so + lifts it.
STAND = both(tail({'pelvis': 0, 'spine': 2, 'chest': -2, 'neck': -4, 'head': 6}, 0, 0),
             upperarm=0, forearm=0, frontpaw=0, thigh=0, shin=0, hock=0, hindpaw=0)
STAND_BREATH = both(tail({'pelvis': 0, 'spine': 3, 'chest': -3, 'neck': -6, 'head': 8}, (2, 6, 0), (0, 4, 0)),
                    upperarm=0, forearm=0, frontpaw=0, thigh=0, shin=0, hock=0, hindpaw=0)

LEAP = [  # (time, pose, root lift in metres)
    # gathered: crouched, hind feet under the body, front legs folding
    (0.0, both(tail({'pelvis': -8, 'spine': 8, 'chest': 2, 'neck': -4, 'head': 8}, 0, 0),
               upperarm=-22, forearm=48, frontpaw=-38, thigh=-42, shin=58, hock=-38, hindpaw=14), -0.06),
    # push-off: hind legs driving back, front legs reaching up and forward
    (0.25, both(tail({'pelvis': -18, 'spine': -3, 'chest': -4, 'neck': 2, 'head': 10}, 14, 2),
                upperarm=-68, forearm=34, frontpaw=62, thigh=42, shin=-14, hock=40, hindpaw=42), 0.02),
    # full stretch in the air: front legs straight ahead, hind legs straight back, tail streaming
    (0.5, both(tail({'pelvis': -4, 'spine': -6, 'chest': -4, 'neck': 12, 'head': 4}, 22, 4, -8),
               upperarm=-68, forearm=-12, frontpaw=4, thigh=70, shin=4, hock=26, hindpaw=40), 0.06),
    # reaching down for the landing, tail up to balance
    (0.75, both(tail({'pelvis': 14, 'spine': 4, 'chest': 2, 'neck': 8, 'head': -12}, 16, 2),
                upperarm=-42, forearm=0, frontpaw=-14, thigh=30, shin=10, hock=20, hindpaw=22), 0.02),
    # landed: front feet planted, hind feet coming in under it
    (1.0, both(tail({'pelvis': 4, 'spine': 8, 'chest': 0, 'neck': -2, 'head': 6}, 8, 0),
               upperarm=4, forearm=16, frontpaw=-20, thigh=-26, shin=42, hock=-26, hindpaw=10), -0.04),
]


def rot(pose, name):
    v = pose.get(name, 0)
    return quat_from_euler(*(v if isinstance(v, tuple) else (v, 0, 0)))


def catmull(keys, t):
    """Smooth curve through (time, value) keys, value arrays."""
    ts = [k[0] for k in keys]
    i = max(0, min(len(keys) - 2, np.searchsorted(ts, t, side='right') - 1))
    t0, t1 = ts[i], ts[i + 1]
    u = (t - t0) / (t1 - t0)
    p0 = keys[max(0, i - 1)][1]
    p1, p2 = keys[i][1], keys[i + 1][1]
    p3 = keys[min(len(keys) - 1, i + 2)][1]
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)


def sample_clip(keys, duration, fps=30):
    """keys: [(t, pose, lift)]; returns times, {bone: quats}, root translations."""
    times = np.linspace(0, duration, int(duration * fps) + 1)
    out = {}
    for name in NAMES:
        eul = [(t, np.array(p.get(name, 0) if isinstance(p.get(name, 0), tuple) else (p.get(name, 0), 0, 0), float)) for t, p, _ in keys]
        q = np.array([quat_from_euler(*catmull(eul, t)) for t in times])
        if np.abs(q - [0, 0, 0, 1]).max() > 1e-6:
            out[name] = q
    lift = [(t, np.array([l], float)) for t, _, l in keys]
    root = np.array([HEAD[0] + [0, catmull(lift, t)[0], 0] for t in times])
    return times, out, root

# ---------------------------------------------------------------- glTF


def write_glb(path, v, t, n, colour, joints, weights, clips):
    blob = bytearray()
    views, accessors = [], []

    def add(data, target=None):
        while len(blob) % 4:
            blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), **({'target': target} if target else {})})
        blob.extend(data)
        return len(views) - 1

    def acc(arr, ctype, typ, normalized=False, target=None, minmax=False):
        a = {'bufferView': add(arr.tobytes(), target), 'componentType': ctype, 'count': len(arr), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = arr.min(0).tolist() if arr.ndim > 1 else [float(arr.min())]
            a['max'] = arr.max(0).tolist() if arr.ndim > 1 else [float(arr.max())]
        accessors.append(a)
        return len(accessors) - 1

    F, UB, US, UI = 5126, 5121, 5123, 5125
    pos = acc(v.astype(np.float32), F, 'VEC3', target=34962, minmax=True)
    nor = acc(n.astype(np.float32), F, 'VEC3', target=34962)
    col = acc(colour, UB, 'VEC4', normalized=True, target=34962)
    jnt = acc(joints, UB, 'VEC4', target=34962)
    wgt = acc(weights, UB, 'VEC4', normalized=True, target=34962)
    idx = acc(t.astype(np.uint16 if len(v) < 65536 else np.uint32).reshape(-1), US if len(v) < 65536 else UI, 'SCALAR', target=34963)
    ibm = np.array([np.array([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [-h[0], -h[1], -h[2], 1]], np.float32).reshape(-1) for h in HEAD], np.float32)
    ibm_acc = acc(ibm, F, 'MAT4')

    nodes = []
    for i, (name, parent, head, _) in enumerate(BONES):
        local = np.array(head) - (np.array(BONES[INDEX[parent]][2]) if parent else 0)
        node = {'name': name, 'translation': [float(x) for x in local]}
        kids = [j for j, b in enumerate(BONES) if b[1] == name]
        if kids:
            node['children'] = kids
        nodes.append(node)
    mesh_node = len(nodes)
    nodes.append({'name': 'snow-leopard', 'mesh': 0, 'skin': 0})
    armature = len(nodes)
    nodes.append({'name': 'Armature', 'children': [0]})

    animations = []
    for name, (times, rots, root) in clips.items():
        samplers, channels = [], []
        tin = acc(times.astype(np.float32), F, 'SCALAR', minmax=True)
        for bone, q in rots.items():
            samplers.append({'input': tin, 'output': acc(q.astype(np.float32), F, 'VEC4'), 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': INDEX[bone], 'path': 'rotation'}})
        samplers.append({'input': tin, 'output': acc(root.astype(np.float32), F, 'VEC3'), 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': 0, 'path': 'translation'}})
        animations.append({'name': name, 'samplers': samplers, 'channels': channels})

    gltf = {
        'asset': {'version': '2.0', 'generator': 'snow-leopard.py (Snolep)'},
        'scene': 0,
        'scenes': [{'nodes': [armature, mesh_node]}],
        'nodes': nodes,
        'meshes': [{'name': 'snow-leopard', 'primitives': [{
            'attributes': {'POSITION': pos, 'NORMAL': nor, 'COLOR_0': col, 'JOINTS_0': jnt, 'WEIGHTS_0': wgt},
            'indices': idx, 'material': 0}]}],
        'materials': [{'name': 'fur', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.92}}],
        'skins': [{'joints': list(range(len(BONES))), 'inverseBindMatrices': ibm_acc, 'skeleton': 0}],
        'animations': animations,
        'buffers': [{'byteLength': len(blob)}],
        'bufferViews': views,
        'accessors': accessors,
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    while len(blob) % 4:
        blob.append(0)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))


def main(path):
    v, t = build_mesh()
    n = vertex_normals(v, t)
    joints, weights = skin_weights(v)
    colour = coat(v, n)
    clips = {
        'Stand': sample_clip([(0, STAND, 0), (2, STAND_BREATH, 0.004), (4, STAND, 0)], 4, fps=10),
        'Leap': sample_clip(LEAP, 1.0, fps=30),
    }
    write_glb(path, v, t, n, colour, joints, weights, clips)
    print(f'{path}: {len(v)} vertices, {len(t)} triangles')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'snow-leopard.glb')
