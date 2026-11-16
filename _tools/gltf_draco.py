"""Minimal GLB writer: Draco-compressed primitives with optional NORMAL / TEXCOORD_0 and embedded images."""
import json, struct, numpy as np, DracoPy
TYPE_NAME = {0: 'POSITION', 1: 'NORMAL', 3: 'TEXCOORD_0'}

def write_glb(path, prims, nodes_matrix=None):
    """prims: list of dict(name, v, f, n=None, uv=None, material=dict, image=bytes|None, mime='image/jpeg')."""
    bin_ = bytearray(); views, accessors, meshes, nodes, mats, images, textures = [], [], [], [], [], [], []
    def add_view(data):
        while len(bin_) % 4: bin_.append(0)
        views.append({'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data)}); bin_.extend(data); return len(views) - 1
    img_index = {}
    for i, p in enumerate(prims):
        v = np.asarray(p['v'], np.float64); f = np.asarray(p['f'], np.int64)
        kw = {}
        if p.get('n') is not None: kw['normals'] = np.asarray(p['n'], np.float64)
        if p.get('uv') is not None: kw['tex_coord'] = np.asarray(p['uv'], np.float64)
        enc = DracoPy.encode(v, f, quantization_bits=14, compression_level=10, normal_quantization_bits=10,
                             tex_coord_quantization_bits=12, **kw)
        ids = {TYPE_NAME[a['attribute_type']]: a['unique_id'] for a in DracoPy.decode(enc).attributes if a['attribute_type'] in TYPE_NAME}
        bv = add_view(enc)
        attrs = {}
        attrs['POSITION'] = len(accessors); accessors.append({'componentType': 5126, 'count': len(v), 'type': 'VEC3', 'min': v.min(0).tolist(), 'max': v.max(0).tolist()})
        if 'NORMAL' in ids: attrs['NORMAL'] = len(accessors); accessors.append({'componentType': 5126, 'count': len(v), 'type': 'VEC3'})
        if 'TEXCOORD_0' in ids: attrs['TEXCOORD_0'] = len(accessors); accessors.append({'componentType': 5126, 'count': len(v), 'type': 'VEC2'})
        idx = len(accessors); accessors.append({'componentType': 5125, 'count': int(f.size), 'type': 'SCALAR'})
        mat = dict(p['material'])
        if p.get('image') is not None:
            key = p.get('image_key', id(p['image']))
            if key not in img_index:
                images.append({'bufferView': add_view(p['image']), 'mimeType': p.get('mime', 'image/jpeg')})
                textures.append({'source': len(images) - 1}); img_index[key] = len(textures) - 1
            mat.setdefault('pbrMetallicRoughness', {})['baseColorTexture'] = {'index': img_index[key]}
        mats.append(mat)
        meshes.append({'name': p['name'], 'primitives': [{'attributes': attrs, 'indices': idx, 'material': i,
                       'extensions': {'KHR_draco_mesh_compression': {'bufferView': bv, 'attributes': {k: ids[k] for k in attrs}}}}]})
        nodes.append({'mesh': i, 'name': p['name']})
    g = {'asset': {'version': '2.0', 'generator': 'stateq gltf_draco.py'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
         'nodes': nodes, 'meshes': meshes, 'materials': mats, 'accessors': accessors, 'bufferViews': views,
         'buffers': [{'byteLength': 0}], 'extensionsUsed': ['KHR_draco_mesh_compression'], 'extensionsRequired': ['KHR_draco_mesh_compression']}
    if images: g['images'] = images; g['textures'] = textures
    bin_ += b'\0' * (-len(bin_) % 4); g['buffers'][0]['byteLength'] = len(bin_)
    js = json.dumps(g, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bin_
    open(path, 'wb').write(out); return len(out)
