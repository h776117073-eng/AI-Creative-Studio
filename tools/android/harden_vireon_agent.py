from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1])
UI = ROOT / "app/src/main/java/com/novacut/editor/ui/editor"
agent = UI / "VireonArabicCommandAgent.kt"
if not agent.exists():
    raise SystemExit("VireonArabicCommandAgent.kt not found")
text = agent.read_text(encoding='utf-8')

text = re.sub(
    r'    private val executable = setOf\(.*?\n    \)',
    '''    private val executable = setOf(
        "SPLIT", "TRIM", "DELETE_SILENCE", "DENOISE", "DUPLICATE", "SPEED", "CAMERA_MOTION",
        "COLOR_CURVE", "COLOR_GRADE", "CINEMATIC_NIGHT", "MASK", "TRANSITION", "KEYFRAME",
        "TEXT", "CAPTIONS", "MOTION_TRACK", "BACKGROUND_REMOVE", "AUDIO", "ROTATE", "FLIP", "UPSCALE"
    )''',
    text,
    count=1,
    flags=re.S,
)

old_start = text.index('    suspend fun execute(context: Context, viewModel: EditorViewModel, text: String) {')
old_end = text.index('\n    }', old_start) + len('\n    }')
new_body = '''    suspend fun execute(context: Context, viewModel: EditorViewModel, text: String) {
        val plan = plan(text)
        for (op in plan.operations) when (op.optString("intent")) {
            "SPLIT" -> viewModel.splitAtPlayhead()
            "TRIM" -> {
                val id = viewModel.state.value.selectedClipId
                val seconds = op.optDouble("seconds", Double.NaN)
                if (id != null && !seconds.isNaN()) {
                    val clip = viewModel.state.value.tracks.flatMap { it.clips }.firstOrNull { it.id == id }
                    if (clip != null) {
                        val end = (clip.trimStartMs + (seconds * 1000.0).toLong())
                            .coerceIn(clip.trimStartMs + 1L, clip.trimEndMs)
                        viewModel.trimClip(id, newTrimEndMs = end)
                    }
                } else {
                    viewModel.beginTrim()
                }
            }
            "DELETE_SILENCE" -> {
                // Real native cut-assistant workflow: analysis creates undo-safe proposals.
                // Applying all proposals is intentionally left to the review surface so
                // destructive automatic cuts are never hidden behind a false success.
                viewModel.proposeCutsForReview()
                viewModel.showPanel(PanelId.AI_TOOLS)
            }
            "DENOISE" -> viewModel.analyzeAndReduceNoise()
            "DUPLICATE" -> viewModel.duplicateSelectedClip()
            "SPEED" -> {
                val id = viewModel.state.value.selectedClipId
                val factor = op.optDouble("speed", Double.NaN).toFloat()
                if (id != null && !factor.isNaN()) {
                    viewModel.beginSpeedChange()
                    viewModel.setClipSpeed(id, factor.coerceIn(0.1f, 10f))
                    viewModel.endSpeedChange()
                } else {
                    viewModel.showSpeedCurveEditor()
                }
            }
            "CAMERA_MOTION" -> viewModel.showTransformPanel()
            "COLOR_CURVE", "COLOR_GRADE", "CINEMATIC_NIGHT" -> viewModel.showColorGrading()
            "MASK" -> viewModel.showMaskEditor()
            "TRANSITION" -> viewModel.showPanel(PanelId.TRANSITION_PICKER)
            "KEYFRAME" -> viewModel.showTransformPanel()
            "TEXT" -> viewModel.showTextEditor()
            "CAPTIONS" -> viewModel.runAiTool("auto_captions")
            "MOTION_TRACK" -> viewModel.runAiTool("track_motion")
            "BACKGROUND_REMOVE" -> viewModel.showAiToolsPanel()
            "AUDIO" -> viewModel.showAudioMixer()
            "ROTATE", "FLIP" -> viewModel.showTransformPanel()
            "UPSCALE" -> viewModel.runAiTool("upscale")
        }
    }'''
text = text[:old_start] + new_body + text[old_end:]
agent.write_text(text,encoding='utf-8')

screen=UI/'VireonEditorScreen.kt'
s=screen.read_text(encoding='utf-8')
if 'viewModel = viewModel' not in s:
    s=s.replace('''VireonTopBar(\n                    isAr = isAr,''','''VireonTopBar(\n                    isAr = isAr,\n                    viewModel = viewModel,''',1)
s=s.replace('''@Composable private fun VireonTopBar(isAr: Boolean, onBack: () -> Unit, onAssistant: () -> Unit, onSettings: () -> Unit) {''','''@Composable private fun VireonTopBar(isAr: Boolean, viewModel: EditorViewModel, onBack: () -> Unit, onAssistant: () -> Unit, onSettings: () -> Unit) {''',1)
if 'viewModel.undo()' not in s:
    s=s.replace('''IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, if (isAr) "رجوع" else "Back") }\n        IconButton(onClick = onAssistant)''','''IconButton(onClick = { viewModel.undo() }) { Icon(Icons.Default.Undo, if (isAr) "تراجع" else "Undo") }\n        IconButton(onClick = { viewModel.redo() }) { Icon(Icons.Default.Redo, if (isAr) "إعادة" else "Redo") }\n        IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, if (isAr) "رجوع" else "Back") }\n        IconButton(onClick = onAssistant)''',1)
s=s.replace('''Button(onClick = {}, shape = RoundedCornerShape(9.dp),''','''Button(onClick = { viewModel.showExportSheet() }, shape = RoundedCornerShape(9.dp),''',1)
screen.write_text(s,encoding='utf-8')
print('Vireon agent hardened and shell controls wired')
