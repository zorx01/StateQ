"""Per-body decimation (keeps small curved parts), merge by material, z-down CAD -> y-up GLB in metres."""
import pickle, re, sys, numpy as np, trimesh, fast_simplification
src, dst, budget = sys.argv[1], sys.argv[2], int(sys.argv[3])
V, B = pickle.load(open(src, 'rb'))
NAMED = {'Steel_-_Satin': ((168, 172, 178), .85, .32), 'Brass_-_Polished': ((196, 158, 82), 1, .28),
         'Carbon_Fiber_-_Plain': ((24, 25, 28), .15, .38), 'ABS_(White)': ((232, 232, 228), 0, .55),
         'Rubber_-_Black': ((20, 20, 20), 0, .92), 'Prop_Static': ((30, 31, 34), 0, .45), 'Default': ((160, 160, 160), 0, .6)}
def style(m):
    mm = re.match(r'Opaque\((\d+),(\d+),(\d+)\)', m)
    return (tuple(map(int, mm.groups())), 0.05, 0.6) if mm else NAMED.get(m, NAMED['Default'])
total = sum(len(F) for _, _, F in B)
# Tiny parts (screws, SMD parts) are barely visible: cut hard. Larger bodies share the budget, with a floor
# so curved parts (props, motors, dome) keep their shape.
def diag(F):
    p = V[np.unique(F)]; return float(np.linalg.norm(p.max(0) - p.min(0)))
D = [diag(F) for _, _, F in B]
def keep_for(n, d, r):
    # d: body size in cm. Sub-centimetre parts (screws, pins, SMD) are invisible at web scale.
    if d < 0.3: return 0
    if d < 1.0: return min(n, max(12, int(n * 0.04)))
    if n > 8000: return int(n * 0.15)          # props, motors, PCB: curved, heavy
    if n > 3000: return int(n * 0.5)
    return n                                    # plates and brackets: keep exact (holes, edges)
ratio = 0
groups = {}
for (name, mat, F), d in zip(B, D):
    used, inv = np.unique(F, return_inverse=True)
    v, f = V[used], inv.reshape(-1, 3)
    keep = keep_for(len(f), d, ratio)
    if keep == 0:
        continue
    if keep < len(f):
        v, f = fast_simplification.simplify(v, f, target_reduction=1 - keep / len(f))
    g = groups.setdefault(mat, ([], [], [0]))
    g[0].append(v); g[1].append(f + g[2][0]); g[2][0] += len(v)
# CAD frame: z points down (props at -z), units cm. glTF: y up, metres.
R = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], np.float32)  # rotate +90 deg about x: up = -z
scene = trimesh.Scene(); tris = 0
for mat, (vs, fs, _) in groups.items():
    v = (np.concatenate(vs) @ R.T) * 0.01; f = np.concatenate(fs)
    rgb, metal, rough = style(mat)
    # glTF colours are linear; Fusion gives sRGB.
    pm = trimesh.visual.material.PBRMaterial(name=mat, baseColorFactor=[*(((c / 255) ** 2.2) for c in rgb), 1.0], metallicFactor=metal, roughnessFactor=rough, doubleSided=True)
    scene.add_geometry(trimesh.Trimesh(v, f, process=False, visual=trimesh.visual.TextureVisuals(material=pm)), geom_name=mat)
    tris += len(f)
scene.export(dst)
b = scene.bounds; print('tris', tris, 'ratio', round(ratio, 3), 'bounds m', np.round(b, 3))
