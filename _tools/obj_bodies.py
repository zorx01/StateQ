"""Parse Fusion OBJ into bodies (g) with material; save npz for fast iteration."""
import sys, numpy as np, pickle
src, dst = sys.argv[1], sys.argv[2]
verts = []; bodies = []; cur = None; mat = 'Default'
with open(src) as f:
    for line in f:
        c = line[:2]
        if c == 'v ': verts.append(line[2:])
        elif c == 'f ':
            if cur is None or cur['mat'] != mat:
                cur = {'name': cur['name'] if cur else 'body', 'mat': mat, 'f': []}; bodies.append(cur)
            cur['f'].append(line[2:])
        elif line.startswith('g '):
            cur = {'name': line[2:].strip(), 'mat': mat, 'f': []}; bodies.append(cur)
        elif line.startswith('usemtl '):
            mat = line[7:].strip()
            if cur is not None and not cur['f']: cur['mat'] = mat
V = np.loadtxt(verts, dtype=np.float32)
out = []
for b in bodies:
    if not b['f']: continue
    F = np.array([[int(t.split('/')[0]) - 1 for t in fl.split()[:3]] for fl in b['f']], dtype=np.int64)
    out.append((b['name'], b['mat'], F))
pickle.dump((V, out), open(dst, 'wb'))
print(len(V), 'verts', len(out), 'bodies', sum(len(o[2]) for o in out), 'faces')
