"""Pack export_cloud.py output for the web: discovery-bucketed, Morton-sorted, delta-coded int16 voxels, gzipped.
Writes cave.points.gz and cave.json (bucket counts + voxel size). Points stay in discovery order by bucket."""
import sys, json, gzip, numpy as np
src, dst, vox_cm, B = sys.argv[1], sys.argv[2], 11, 256
p = np.frombuffer(open(f'{src}/cave_points.bin', 'rb').read(), np.int16).reshape(-1, 3).astype(np.int32)
t = np.frombuffer(open(f'{src}/cave_points_t.bin', 'rb').read(), np.uint16)
meta = json.load(open(f'{src}/cave_meta.json'))
v = np.round(p / vox_cm).astype(np.int32)
def morton(a):
    a = a - a.min(0); key = np.zeros(len(a), np.int64)
    for b in range(10):
        for d in range(3): key |= ((a[:, d] >> b) & 1).astype(np.int64) << (3 * b + d)
    return key
bucket = np.minimum((t.astype(np.int64) * B) // 65536, B - 1)
out, counts = [], []
for k in range(B):
    idx = np.where(bucket == k)[0]
    out.append(v[idx][np.argsort(morton(v[idx]))] if len(idx) else v[idx]); counts.append(int(len(idx)))
vs = np.concatenate(out)
d = np.diff(vs, axis=0, prepend=np.zeros((1, 3), np.int32))
assert np.abs(d).max() < 32768
open(f'{dst}/cave.points.gz', 'wb').write(gzip.compress(d.astype('<i2').tobytes(), 9))
json.dump({'run': meta['run'], 'points': int(len(vs)), 'voxel_m': vox_cm / 100, 'buckets': counts,
           'duration_s': meta['duration_s'],
           'encoding': 'gzip(int16 xyz deltas, z-up, voxel units); cumulative sum gives voxel coords'},
          open(f'{dst}/cave.json', 'w'))
print(len(vs), 'points ->', len(gzip.compress(d.astype('<i2').tobytes(), 9)), 'bytes')
