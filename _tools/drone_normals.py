"""drone3.glb (y-up export) -> Draco GLB with precomputed creased normals (no runtime normal work)."""
import json, struct, sys, numpy as np, trimesh
from gltf_draco import write_glb
src, dst = sys.argv[1], sys.argv[2]
raw = open(src, 'rb').read(); jl = struct.unpack_from('<I', raw, 12)[0]; gj = json.loads(raw[20:20 + jl])
scene = trimesh.load(src, force='scene'); prims = []
for name, g in scene.geometry.items():
    g = trimesh.Trimesh(g.vertices, g.faces, process=True)
    s = trimesh.graph.smooth_shade(g, angle=np.radians(30))  # split at hard CAD edges, smooth the rest
    mat = next(x for x in gj['materials'] if x.get('name') == name)
    prims.append({'name': name, 'v': s.vertices, 'f': s.faces, 'n': s.vertex_normals, 'material': mat})
print('bytes', write_glb(dst, prims), 'tris', sum(len(p['f']) for p in prims))
