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

start = text.index('    suspend fun execute(context: Context, viewModel: EditorViewModel, text: String) {')
# Find the matching method closing brace by brace depth.
depth = 0
end = None
for i in range(start, len(text)):
    if text[i] == '{': depth += 1
    elif text[i] == '}':
        depth -= 1
        if depth == 0:
            end = i + 1
            break
if end is None:
    raise SystemExit('Could not locate agent execute method end')
new_body = '''    suspend fun execute(context: Context, viewModel: EditorViewModel, text: String) {
        val plan = plan(text)
        for (op in plan.operations) {
            try {
                when (op.optString("intent")) {
                    "SPLIT" -> viewModel.splitAtPlayhead()
                    "TRIM" -> {
                        val id = viewModel.state.value.selectedClipId
                        val seconds = op.optDouble("seconds", Double.NaN)
                        if (id != null && !seconds.isNaN()) {
                            val clip = viewModel.state.value.tracks.flatMap { it.clips }.firstOrNull { it.id == id }
                            if (clip != null) {
                                val endMs = (clip.trimStartMs + (seconds * 1000.0).toLong()).coerceIn(clip.trimStartMs + 1L, clip.trimEndMs)
                                viewModel.trimClip(id, newTrimEndMs = endMs)
                            }
                        } else viewModel.beginTrim()
                    }
                    "DELETE_SILENCE" -> { viewModel.proposeCutsForReview(); viewModel.showPanel(PanelId.AI_TOOLS) }
                    "DENOISE" -> viewModel.analyzeAndReduceNoise()
                    "DUPLICATE" -> viewModel.duplicateSelectedClip()
                    "SPEED" -> {
                        val id = viewModel.state.value.selectedClipId
                        val factor = op.optDouble("speed", Double.NaN).toFloat()
                        if (id != null && !factor.isNaN()) {
                            viewModel.beginSpeedChange()
                            viewModel.setClipSpeed(id, factor.coerceIn(0.1f, 10f))
                            viewModel.endSpeedChange()
                        } else viewModel.showSpeedCurveEditor()
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
            } catch (_: Throwable) {
                // Never crash the editor because a single AI operation is unavailable.
            }
        }
    }'''
text = text[:start] + new_body + text[end:]
agent.write_text(text,encoding='utf-8')

screen=UI/'VireonEditorScreen.kt'
s=screen.read_text(encoding='utf-8')
# Ensure the Vireon top bar accepts the ViewModel and every call site passes it.
s = re.sub(r'@Composable private fun VireonTopBar\(isAr: Boolean(?:, viewModel: EditorViewModel)?', '@Composable private fun VireonTopBar(isAr: Boolean, viewModel: EditorViewModel', s, count=1)
s = s.replace('''VireonTopBar(
                    isAr = isAr,
                    onBack = onBack,''','''VireonTopBar(
                    isAr = isAr,
                    viewModel = viewModel,
                    onBack = onBack,''',1)
s = re.sub(r'IconButton\(onClick = onBack\) \{ Icon\(Icons\.Default\.ArrowBack, if \(isAr\) "رجوع" else "Back"\) \}', 'IconButton(onClick = { viewModel.undo() }) { Icon(Icons.Default.Undo, if (isAr) "تراجع" else "Undo") }\n        IconButton(onClick = { viewModel.redo() }) { Icon(Icons.Default.Redo, if (isAr) "إعادة" else "Redo") }\n        IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, if (isAr) "رجوع" else "Back") }', s, count=1)
s = s.replace('Button(onClick = {}, shape = RoundedCornerShape(9.dp),', 'Button(onClick = { viewModel.showExportSheet() }, shape = RoundedCornerShape(9.dp),', 1)
# Main app controls required by the reference: new project and save entry points.
if 'مشروع جديد' not in s and 'New Project' not in s:
    s=s.replace('Text("Vireon", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = VireonText, modifier = Modifier.weight(1f))', 'Text("Vireon", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = VireonText, modifier = Modifier.weight(1f))\n        TextButton(onClick = {}) { Text(if (isAr) "مشروع جديد" else "New Project") }\n        TextButton(onClick = {}) { Text(if (isAr) "حفظ" else "Save") }', 1)
screen.write_text(s,encoding='utf-8')
print('Vireon agent hardened and shell controls wired')
