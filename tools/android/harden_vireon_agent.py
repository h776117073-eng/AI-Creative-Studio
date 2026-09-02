from pathlib import Path
import sys

ROOT = Path(sys.argv[1])
UI = ROOT / "app/src/main/java/com/novacut/editor/ui/editor"
agent = UI / "VireonArabicCommandAgent.kt"
if not agent.exists():
    raise SystemExit("VireonArabicCommandAgent.kt not found")
text = agent.read_text(encoding='utf-8')
text = text.replace('''    private val executable = setOf(
        "SPLIT", "DELETE_SILENCE", "DENOISE", "DUPLICATE", "SPEED", "CAMERA_MOTION",
        "COLOR_CURVE", "COLOR_GRADE", "CINEMATIC_NIGHT", "CAPTIONS", "MOTION_TRACK",
        "BACKGROUND_REMOVE", "AUDIO"
    )''','''    private val executable = setOf(
        "SPLIT", "TRIM", "DELETE_SILENCE", "DENOISE", "DUPLICATE", "SPEED", "CAMERA_MOTION",
        "COLOR_CURVE", "COLOR_GRADE", "CINEMATIC_NIGHT", "MASK", "TRANSITION", "KEYFRAME",
        "TEXT", "CAPTIONS", "MOTION_TRACK", "BACKGROUND_REMOVE", "AUDIO", "ROTATE", "FLIP", "UPSCALE"
    )''')
old='''    suspend fun execute(context: Context, viewModel: EditorViewModel, text: String) {
        val plan = plan(text)
        for (op in plan.operations) when (op.optString("intent")) {
            "SPLIT" -> viewModel.splitAtPlayhead()
            "DELETE_SILENCE", "DENOISE" -> viewModel.analyzeAndReduceNoise()
            "DUPLICATE" -> viewModel.duplicateSelectedClip()
            "SPEED" -> viewModel.showSpeedCurveEditor()
            "CAMERA_MOTION" -> viewModel.showTransformPanel()
            "COLOR_CURVE", "COLOR_GRADE", "CINEMATIC_NIGHT" -> viewModel.showColorGrading()
            "CAPTIONS" -> viewModel.showPanel(PanelId.CAPTION_EDITOR)
            "MOTION_TRACK" -> viewModel.showPanel(PanelId.AI_TOOLS)
            "BACKGROUND_REMOVE" -> viewModel.showAiToolsPanel()
            "AUDIO" -> viewModel.showAudioMixer()
        }
    }'''
new='''    suspend fun execute(context: Context, viewModel: EditorViewModel, text: String) {
        val plan = plan(text)
        for (op in plan.operations) when (op.optString("intent")) {
            "SPLIT" -> viewModel.splitAtPlayhead()
            "TRIM" -> {
                val id = viewModel.state.value.selectedClipId
                val seconds = op.optDouble("seconds", Double.NaN)
                if (id != null && !seconds.isNaN()) {
                    val clip = viewModel.state.value.tracks.flatMap { it.clips }.firstOrNull { it.id == id }
                    if (clip != null) {
                        val end = (clip.trimStartMs + (seconds * 1000.0).toLong()).coerceIn(clip.trimStartMs + 1L, clip.trimEndMs)
                        viewModel.trimClip(id, newTrimEndMs = end)
                    }
                } else viewModel.beginTrim()
            }
            "DELETE_SILENCE" -> viewModel.analyzeAndReduceNoise()
            "DENOISE" -> viewModel.analyzeAndReduceNoise()
            "DUPLICATE" -> viewModel.duplicateSelectedClip()
            "SPEED" -> {
                val id = viewModel.state.value.selectedClipId
                val factor = op.optDouble("speed", Double.NaN).toFloat()
                if (id != null && !factor.isNaN()) viewModel.setClipSpeed(id, factor.coerceIn(0.1f, 10f)) else viewModel.showSpeedCurveEditor()
            }
            "CAMERA_MOTION" -> viewModel.showTransformPanel()
            "COLOR_CURVE", "COLOR_GRADE", "CINEMATIC_NIGHT" -> viewModel.showColorGrading()
            "MASK" -> viewModel.showMaskEditor()
            "TRANSITION" -> viewModel.showPanel(PanelId.TRANSITION_PICKER)
            "KEYFRAME" -> viewModel.showTransformPanel()
            "TEXT" -> viewModel.showTextEditor()
            "CAPTIONS" -> viewModel.showPanel(PanelId.CAPTION_EDITOR)
            "MOTION_TRACK" -> viewModel.showPanel(PanelId.AI_TOOLS)
            "BACKGROUND_REMOVE" -> viewModel.showAiToolsPanel()
            "AUDIO" -> viewModel.showAudioMixer()
            "ROTATE", "FLIP", "UPSCALE" -> viewModel.showTransformPanel()
        }
    }'''
if old not in text:
    raise SystemExit("Expected baseline agent execute body was not found")
text=text.replace(old,new,1)
agent.write_text(text,encoding='utf-8')

screen=UI/'VireonEditorScreen.kt'
s=screen.read_text(encoding='utf-8')
s=s.replace('''fun VireonEditorScreen(
    onBack: () -> Unit = {},
    viewModel: EditorViewModel = hiltViewModel(),
)''','''fun VireonEditorScreen(
    onBack: () -> Unit = {},
    viewModel: EditorViewModel = hiltViewModel(),
)''')
s=s.replace('''                VireonTopBar(
                    isAr = isAr,
                    onBack = onBack,''','''                VireonTopBar(
                    isAr = isAr,
                    viewModel = viewModel,
                    onBack = onBack,''',1)
s=s.replace('''@Composable private fun VireonTopBar(isAr: Boolean, onBack: () -> Unit, onAssistant: () -> Unit, onSettings: () -> Unit) {''','''@Composable private fun VireonTopBar(isAr: Boolean, viewModel: EditorViewModel, onBack: () -> Unit, onAssistant: () -> Unit, onSettings: () -> Unit) {''',1)
s=s.replace('''        IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, if (isAr) "رجوع" else "Back") }
        IconButton(onClick = onAssistant)''','''        IconButton(onClick = { viewModel.undo() }) { Icon(Icons.Default.Undo, if (isAr) "تراجع" else "Undo") }
        IconButton(onClick = { viewModel.redo() }) { Icon(Icons.Default.Redo, if (isAr) "إعادة" else "Redo") }
        IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, if (isAr) "رجوع" else "Back") }
        IconButton(onClick = onAssistant)''',1)
s=s.replace('''        Button(onClick = {}, shape = RoundedCornerShape(9.dp), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 7.dp)) {''','''        Button(onClick = { viewModel.showExportSheet() }, shape = RoundedCornerShape(9.dp), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 7.dp)) {''',1)
screen.write_text(s,encoding='utf-8')
print('Vireon agent hardened and shell controls wired')
