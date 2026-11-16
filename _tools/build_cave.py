"""Gazebo cave world (OBJ + textures) -> Draco GLB in the web cloud frame (y-up, centred like cave.points.gz)."""
import io, json, gzip, sys, numpy as np, trimesh
from PIL import Image
from scipy.spatial import cKDTree
from gltf_draco import write_glb
MESHES = '/home/zorx/qnav/sim/cave_world/worlds/models'
S = '.'
C = np.array([-14.181265830993652, 4.516018390655518, 2.699700117111206])   # cloud centre (odom)
spawn = np.array([10.1974, -20.2955, 0.83])
icp = json.load(open('cloud_to_mesh.json')); yaw, T = icp['yaw'], np.array(icp['T'])
Rz = np.array([[np.cos(yaw), -np.sin(yaw), 0], [np.sin(yaw), np.cos(yaw), 0], [0, 0, 1]])
meta = json.load(open('cloud_185820/cave.json'))
d = np.frombuffer(gzip.decompress(open('cloud_185820/cave.points.gz', 'rb').read()), '<i2').reshape(-1, 3).astype(np.int64)
cloud = np.cumsum(d, 0) * meta['voxel_m']                       # centred, z-up
tree = cKDTree(cloud[::4]); lo, hi = cloud.min(0) - 4, cloud.max(0) + 4

def world_to_web(Pw):          # gazebo world (z-up) -> web frame (y-up, centred)
    odom = Pw - spawn
    c = (odom - T) @ Rz          # = Rz^T (odom - T), row-vector form
    c = c - C
    return np.stack([c[:, 0], c[:, 2], -c[:, 1]], 1), c

def tex_bytes(img, size=512):
    im = img.convert('RGB'); im.thumbnail((size, size), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=78, optimize=True, progressive=True); return b.getvalue()

prims = []
def add_obj(path, link_fn, label, keep_far=False):
    sc = trimesh.load(path, force='scene')
    for name, g in sc.geometry.items():
        V = link_fn(np.asarray(g.vertices)); web, cz = world_to_web(V)
        F = np.asarray(g.faces)
        # keep faces with any vertex within 9 m of the scanned cloud (drops tunnels the drone never saw)
        vin = np.all((cz > lo) & (cz < hi), 1); near = np.zeros(len(cz), bool)
        if vin.any(): near[vin] = tree.query(cz[vin])[0] < 9
        keep = near[F].any(1)
        if keep.sum() == 0: continue
        F = F[keep]; used, inv = np.unique(F, return_inverse=True)
        mesh = trimesh.Trimesh(web[used], inv.reshape(-1, 3), process=False)
        uv = getattr(g.visual, 'uv', None); uv = uv[used] if uv is not None and len(uv) == len(V) else None
        mat = getattr(g.visual, 'material', None); img = getattr(mat, 'image', None)
        kd = getattr(mat, 'diffuse', None)
        base = [1, 1, 1, 1] if img is not None else [*(np.asarray(kd[:3]) / 255) ** 2.2, 1] if kd is not None else [0.35, 0.33, 0.3, 1]
        prims.append({'name': f'{label}:{name}', 'v': mesh.vertices, 'f': mesh.faces, 'n': mesh.vertex_normals,
                      'uv': uv if img is not None else None, 'image': tex_bytes(img) if img is not None else None,
                      'image_key': f'{label}:{getattr(mat, "name", name)}:{id(img)}',
                      'material': {'name': name, 'pbrMetallicRoughness': {'baseColorFactor': [float(x) for x in base], 'metallicFactor': 0, 'roughnessFactor': 0.95}}})
        print(f'{label:9s} {name[:40]:40s} {len(mesh.faces):6d} tex={img is not None}')

# cave: OBJ y-up, link roll +90 deg, model pose (x, y)
cave_pose = np.array([5.66804, -21.9271, 0])
add_obj(f'{MESHES}/cave_world/meshes/cave_world.obj', lambda v: np.stack([v[:, 0], -v[:, 2], v[:, 1]], 1) + cave_pose, 'cave', keep_far=True)
# start yard: asphalt plane 9 x 11.7 m at (10.469, -20.558), yaw -90 deg, top at z = 0.05
hx, hy = 11.7 / 2, 9 / 2
quad = np.array([[-hx, -hy, 0.05], [hx, -hy, 0.05], [hx, hy, 0.05], [-hx, hy, 0.05]]) + [10.469, -20.5581, 0]
web, _ = world_to_web(quad)
img = Image.open(f'{MESHES}/asphalt_plane/materials/textures/tarmac.png')
prims.append({'name': 'yard', 'v': web, 'f': np.array([[0, 1, 2], [0, 2, 3]]), 'n': np.tile([0, 1, 0], (4, 1)),
              'uv': np.array([[0, 0], [3, 0], [3, 2.3], [0, 2.3]]), 'image': tex_bytes(img, 256), 'image_key': 'tarmac',
              'material': {'name': 'yard', 'pbrMetallicRoughness': {'baseColorFactor': [0.55, 0.55, 0.55, 1], 'metallicFactor': 0, 'roughnessFactor': 1}}})
n = write_glb(sys.argv[1], prims)
print('GLB bytes', n, 'tris', sum(len(p['f']) for p in prims))
