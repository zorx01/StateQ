# StateQ website asset tools

Scripts that built the 3D assets in `assets/`. The folder name starts with `_`, so GitHub Pages (Jekyll) does not publish it.
Keep it that way: do not add a `.nojekyll` file to the repo root, or these scripts become public.
Python deps: `numpy scipy trimesh fast-simplification DracoPy Pillow` (a venv works best).

| Asset | Steps |
|---|---|
| `assets/data/cave.points.gz`, `cave.json`, `cave_path*.bin` | `export_cloud.py <run_dir> <out> 0.11` (uses `~/qnav/scripts/fuse_point_cloud.py`), then `pack_cloud.py <out> <out>` |
| `assets/models/drone.glb` | `obj_bodies.py "drone 1.obj" bodies.pkl` → `bodies_to_glb.py bodies.pkl drone3.glb 0` → `drone_normals.py drone3.glb drone.glb` → `drone_materials.py drone.glb drone.glb` |
| `assets/models/cave_world.glb` | `build_cave.py cave_world.glb` (needs `cloud_to_mesh.json`, the ICP alignment of the cloud to the Gazebo cave) |

Source run for the cloud: `~/workspace/logging/offline_capture/runs/super_20261007_185820`.
The drone STEP file is in `~/Desktop/drone-cad/`.
