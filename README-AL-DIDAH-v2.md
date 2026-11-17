# AL-DIDAH v2 — Full-frame reverse analysis

This version replaces the old sparse sampling/unstable detection-index motion logic.

## Fixes
- Decodes every source frame (6990 frames / 24 FPS for the currently registered source).
- Stable shot-scoped track IDs via Hungarian assignment using bounding-box IoU, normalized center displacement and L1-normalized HSV appearance histograms.
- Computes velocity/acceleration only across detections separated by at most two source frames. Missing/long-gap values remain null.
- Preserves raw keypoints/confidence alongside EMA-smoothed positions.
- Background camera-motion proxy via Lucas–Kanade + RANSAC affine fit, masking detected subject boxes.
- Compressed per-frame JSONL, per-joint motion curves, track crops, shot keyframes, pose-overlay video and SHA-256 inventory.
- The opening/logo scene is preserved and tagged for editorial review; no automatic trimming.

## Run
Pushes to `tasks/current_task.py` trigger `.github/workflows/colab_on_demand.yml`. Automatic runs request T4 and allow up to 1800 seconds of Colab execution (55-minute Actions job limit).

The workflow requires repository secret `COLAB_CREDENTIALS` with Google ADC JSON. It is not printed or stored in the artifacts. GitHub Actions token is used to create a new versioned Release.

## Inputs
- Source video Drive file ID: `1ygz0hzQNH70VsP8-2DCSFO9OFPg7JB4_`
- Two character reference Drive IDs in `tasks/al_didah_pipeline.py`, with public repository image mirrors as fallback.

## Release outputs
- `pose_tracks.jsonl.gz`: one record per source frame.
- `motion_curves.csv`: per-track per-joint measurements and derivatives.
- `camera_motion.csv`: background camera-motion estimates.
- `track_catalog.csv`, `track_crops/`, `keyframes/`.
- `pose_overlay_preview_6fps.mp4`.
- Character reference originals, transparent masters and preview.
- Video/scene metadata, audio, quality report and SHA-256 inventory.

## Limits
This does not recover the original authoring source code, hidden 3D geometry, fingers or native rigs. YOLO COCO-17 can miss stylized anime poses. Track IDs can split at cuts/occlusions. The top two tracks are only provisional character assignments. Two still images are not a full turnaround or rig; final anime animation requires approved model sheets, rigging, key animation, compositing and shot QA.
