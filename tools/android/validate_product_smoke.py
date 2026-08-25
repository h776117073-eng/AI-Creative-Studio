from pathlib import Path
import sys

root = Path(sys.argv[1])
assistant = (root / "app/src/main/java/com/novacut/editor/ui/editor/AssistantCommandExecutor.kt").read_text()
required = [
    "splitAtPlayhead", "deleteSelectedClip", "duplicateSelectedClip",
    "addKeyframe", "updateClipColorGrade", "addMask", "setTransition",
    "addTextOverlay", "showAudioPanel", "showSpeedCurveEditor",
    "showAiToolsPanel", "analyzeAndReduceNoise"
]
missing = [name for name in required if name not in assistant]
if missing:
    raise SystemExit(f"Missing assistant command bindings: {missing}")

catalog = (root / "gradle/libs.versions.toml").read_text()
for needle in [
    "media3-transformer",
    "onnxruntime-android",
    "mediapipe-tasks-vision",
    "android-deepfilternet",
]:
    if needle not in catalog:
        raise SystemExit(f"Missing engine dependency: {needle}")

# Verify the assistant contains explicit advanced operation semantics rather than
# merely opening a generic tool panel.
for needle in ["POSITION_X", "ColorGrade", "ColorCurves", "MaskType.ELLIPSE", "TransitionType.DISSOLVE"]:
    if needle not in assistant:
        raise SystemExit(f"Assistant lacks advanced operation: {needle}")

print("Product smoke validation: PASS")
