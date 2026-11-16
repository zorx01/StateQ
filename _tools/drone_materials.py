"""drone.glb -> drone.glb with real-world materials in place of the CAD placeholder colours.
Rewrites only the glTF JSON chunk (materials); the Draco geometry is copied unchanged. Run after drone_normals.py."""
import json, re, struct, sys

def lin(c):  # sRGB 0..255 -> linear 0..1
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def pbr(color, metal, rough, **ext):
    m = {'pbrMetallicRoughness': {'baseColorFactor': [*color, 1], 'metallicFactor': metal, 'roughnessFactor': rough}}
    if ext: m['extensions'] = ext
    return m

CLEARCOAT = {'KHR_materials_clearcoat': {'clearcoatFactor': 1.0, 'clearcoatRoughnessFactor': 0.12}}
NAMED = {
    'Carbon_Fiber_-_Plain': pbr([0.012, 0.013, 0.015], 0.0, 0.42, **CLEARCOAT),
    'Opaque(63,63,63)': pbr([0.012, 0.013, 0.015], 0.0, 0.42, **CLEARCOAT),  # main frame plate, carbon too
    'Steel_-_Satin': pbr([0.55, 0.56, 0.58], 1.0, 0.3),
    'Brass_-_Polished': pbr([0.78, 0.55, 0.25], 1.0, 0.22),
    'Rubber_-_Black': pbr([0.015, 0.015, 0.015], 0.0, 0.85),
    'ABS_(White)': pbr([0.7, 0.7, 0.68], 0.0, 0.45),
    'Prop_Static': pbr([0.02, 0.02, 0.022], 0.0, 0.35, **CLEARCOAT),
    'Default': pbr([0.3, 0.3, 0.3], 0.0, 0.55),
}
# Flat ~1 mm parts in these CAD colours are circuit boards.
PCB = {'Opaque(0,128,0)', 'Opaque(85,255,135)', 'Opaque(255,191,0)'}

def material(name):
    if name in NAMED: return NAMED[name]
    if name in PCB: return pbr([0.01, 0.06, 0.03], 0.0, 0.3, **CLEARCOAT)
    rgb = re.fullmatch(r'Opaque\((\d+),(\d+),(\d+)\)', name)
    if not rgb: return None
    r, g, b = map(int, rgb.groups()); hi, lo = max(r, g, b), min(r, g, b)
    if hi - lo < 40:  # neutral grey
        if hi < 90: return pbr([0.02] * 3, 0.0, 0.5)                   # black anodised / plastic
        if hi < 200: return pbr([0.6, 0.61, 0.63], 1.0, 0.38)          # bare aluminium
        return pbr([lin(hi) * 0.8] * 3, 0.0, 0.5)                      # white plastic
    # Saturated CAD colours (connectors, LEDs, labels): keep the hue, tone it down.
    mean = (r + g + b) / 3
    return pbr([lin(mean + (c - mean) * 0.55) * 0.8 for c in (r, g, b)], 0.0, 0.45)

src, dst = sys.argv[1], sys.argv[2]
raw = open(src, 'rb').read()
jl = struct.unpack_from('<I', raw, 12)[0]
gj = json.loads(raw[20:20 + jl])
for i, m in enumerate(gj['materials']):
    new = material(m.get('name', ''))
    if new: gj['materials'][i] = {'name': m['name'], 'doubleSided': m.get('doubleSided', False), **new}
if any('extensions' in m for m in gj['materials']):
    gj['extensionsUsed'] = sorted(set(gj.get('extensionsUsed', [])) | {'KHR_materials_clearcoat'})
js = json.dumps(gj, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
rest = raw[20 + jl:]  # BIN chunk, unchanged
out = struct.pack('<III', 0x46546C67, 2, 20 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest
open(dst, 'wb').write(out)
print('materials', len(gj['materials']), 'bytes', len(out))
