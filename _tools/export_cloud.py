"""Fuse a QNav run's LiDAR scans into a voxel-downsampled point cloud + trajectory for the web."""
import json, sys, bisect
from pathlib import Path
import numpy as np
sys.path.insert(0, "/home/zorx/qnav/scripts")
import fuse_point_cloud as f

run = Path(sys.argv[1]); out = Path(sys.argv[2]); voxel = float(sys.argv[3]) if len(sys.argv) > 3 else 0.1
edges = f.load_static_edges(run / "tf_static.json")
lidar = f.captures(run, "lidar")
poses, child = f.load_trajectory(run / "trajectory.csv", lidar[0][0] - 2e9, lidar[-1][0] + 2e9)
stamps = [p[0] for p in poses]
px4_t_lidar = f.frame_transform(edges, child, lidar[0][2]["frame_id"])
DT = {7: np.float32, 8: np.float64}
keys = set(); chunks = []; seen = []
for i, (stamp, d, meta) in enumerate(lidar):
    pose = f.pose_at(poses, stamps, stamp)
    if pose is None: continue
    fields = f.cloud_fields(meta)
    dtype = np.dtype({"names": ["x", "y", "z"], "formats": [DT[fields[n]["datatype"]] for n in "xyz"],
                      "offsets": [fields[n]["offset"] for n in "xyz"], "itemsize": meta["point_step"]})
    raw = np.frombuffer((d / meta["payload"]).read_bytes(), dtype=dtype, count=meta["width"] * meta["height"])
    p = np.stack([raw["x"], raw["y"], raw["z"]], 1).astype(np.float64)
    p = p[np.isfinite(p).all(1) & ((p ** 2).sum(1) > 0.16)]
    r, t = f.compose(pose, px4_t_lidar)
    w = p @ np.array(r).T + np.array(t)
    k = np.floor(w / voxel).astype(np.int64)
    kk = (k[:, 0] + 100000) * 10**10 + (k[:, 1] + 100000) * 10**5 + (k[:, 2] + 50000)
    _, idx = np.unique(kk, return_index=True)
    new = [j for j in idx if kk[j] not in keys]
    keys.update(kk[new].tolist()); chunks.append(w[new]); seen.append(np.full(len(new), stamp, np.int64))
    if i % 500 == 0: print(i, len(lidar), len(keys), flush=True)
pts = np.concatenate(chunks).astype(np.float32)
t0, t1 = lidar[0][0], lidar[-1][0]
win = [p for p in poses if t0 <= p[0] <= t1]
xyz = np.array([p[1][1] for p in win]); ts = np.array([p[0] for p in win], np.float64)
keep = [0]  # resample every 0.2 m of travel so the path is evenly spaced
for k in range(1, len(xyz)):
    if np.linalg.norm(xyz[k] - xyz[keep[-1]]) >= 0.2: keep.append(k)
traj = xyz[keep].astype(np.float32); tt = (ts[keep] - t0) / (t1 - t0)
pt = (np.concatenate(seen) - t0) / (t1 - t0)
c = pts.mean(0); pts -= c; traj -= c
print("CENTER", c.tolist())
out.mkdir(parents=True, exist_ok=True)
(out / "cave_points.bin").write_bytes(np.round(pts * 100).astype(np.int16).tobytes())  # cm, int16
(out / "cave_path.bin").write_bytes(np.round(traj * 100).astype(np.int16).tobytes())
(out / "cave_points_t.bin").write_bytes(np.round(np.clip(pt, 0, 1) * 65535).astype(np.uint16).tobytes())
(out / "cave_path_t.bin").write_bytes(np.round(np.clip(tt, 0, 1) * 65535).astype(np.uint16).tobytes())
print("discovered by t=0.1,0.25,0.5,0.75:", [float((pt <= q).mean()) for q in (0.1, .25, .5, .75)])
print("path length m", float(np.linalg.norm(np.diff(traj, axis=0), axis=1).sum()), "duration s", (t1 - t0) / 1e9)
json.dump({"run": run.name, "voxel_m": voxel, "points": len(pts), "path_points": len(traj), "duration_s": (t1 - t0) / 1e9,
           "units": "int16 centimetres, xyz, PX4 local frame centred",
           "bounds_min": pts.min(0).tolist(), "bounds_max": pts.max(0).tolist()},
          open(out / "cave_meta.json", "w"), indent=1)
print("done", len(pts), pts.min(0), pts.max(0))
