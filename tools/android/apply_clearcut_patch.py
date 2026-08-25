from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1])
APP = ROOT / "app"
JAVA = APP / "src/main/java/com/novacut/editor"
UI = JAVA / "ui/editor"

gradle = APP / "build.gradle.kts"
s = gradle.read_text()
s = s.replace('applicationId = "com.novacut.editor"', 'applicationId = "com.aicreativestudio.mobile"')
s = s.replace('versionName = "3.81.0"', 'versionName = "1.0.0"')
s = s.replace('versionCode = 299', 'versionCode = 1')
s = s.replace('compileSdk = 37', 'compileSdk = 36')
s = s.replace('targetSdk = 37', 'targetSdk = 36')
gradle.write_text(s)

strings = APP / "src/main/res/values/strings.xml"
ss = strings.read_text()
ss = re.sub(r'(<string name="app_name">).*?(</string>)', r'\1AI Creative Studio\2', ss, count=1)
strings.write_text(ss)

(UI / "AssistantWorkloadPolicy.kt").write_text(r'''package com.novacut.editor.ui.editor

import android.app.ActivityManager
import android.content.Context
import android.os.Build

object AssistantWorkloadPolicy {
    enum class Route { LOCAL, CLOUD }

    fun route(context: Context, complexity: Int): Route {
        val am = context.getSystemService(ActivityManager::class.java)
        val ramGb = (am?.memoryInfo?.totalMem ?: 0L) / 1024 / 1024 / 1024
        val cores = Runtime.getRuntime().availableProcessors()
        val arm64 = Build.SUPPORTED_ABIS.any { it == "arm64-v8a" }
        val capable = ramGb >= 6 && cores >= 6 && arm64
        return if (capable && complexity <= 2) Route.LOCAL else Route.CLOUD
    }
}
''')

(UI / "AssistantCommandExecutor.kt").write_text(r'''package com.novacut.editor.ui.editor

import android.content.Context
import com.novacut.editor.model.*

suspend fun EditorViewModel.executeAssistantCommand(context: Context, request: AssistantRequest) {
    val state = state.value
    val normalized = request.text.lowercase()
        .replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
        .replace("ى", "ي").replace("ة", "ه")
    val parts = normalized.split(Regex("\\s*(?:ثم|وبعدها|وبعد ذلك|;|\\n)\\s*"))
        .map { it.trim() }.filter { it.isNotEmpty() }
    for (part in parts) {
        when {
            Regex("(قسّم|قسم|split)").containsMatchIn(part) -> splitAtPlayhead()
            Regex("(احذف|حذف|delete)").containsMatchIn(part) -> deleteSelectedClip()
            Regex("(كرر|تكرار|duplicate)").containsMatchIn(part) -> duplicateSelectedClip()
            Regex("(اقلب افقيا|قلب افقي)").containsMatchIn(part) -> showTransformPanel()
            Regex("(سرعه|سرعة|speed)\\s*(?:الى|إلى)?\\s*(\\d+(?:\\.\\d+)?)").containsMatchIn(part) -> {
                val m = Regex("(\\d+(?:\\.\\d+)?)").find(part)?.groupValues?.get(1)?.toFloatOrNull()
                val id = state.selectedClipId
                if (m != null && id != null) setClipSpeed(id, (m / 100f).coerceIn(0.05f, 8f))
            }
            Regex("(حرك|حركة).*(كاميرا|camera)").containsMatchIn(part) -> {
                val id = state.selectedClipId
                val clip = state.tracks.flatMap { it.clips }.firstOrNull { it.id == id }
                if (id != null && clip != null) {
                    val end = minOf(2500L, clip.durationMs.coerceAtLeast(1000L))
                    addKeyframe(KeyframeProperty.POSITION_X, 0L, -0.08f)
                    addKeyframe(KeyframeProperty.POSITION_Y, 0L, 0.02f)
                    addKeyframe(KeyframeProperty.SCALE_X, 0L, 1.0f)
                    addKeyframe(KeyframeProperty.SCALE_Y, 0L, 1.0f)
                    addKeyframe(KeyframeProperty.POSITION_X, end, 0.08f)
                    addKeyframe(KeyframeProperty.POSITION_Y, end, -0.02f)
                    addKeyframe(KeyframeProperty.SCALE_X, end, 1.08f)
                    addKeyframe(KeyframeProperty.SCALE_Y, end, 1.08f)
                }
            }
            Regex("(منحنى لوني|منحنيات الوان|color curve|s curve)").containsMatchIn(part) -> {
                if (state.selectedClipId != null) updateClipColorGrade(
                    ColorGrade(enabled = true, curves = ColorCurves(
                        master = listOf(CurvePoint(0f, 0f), CurvePoint(.25f, .18f), CurvePoint(.5f, .52f), CurvePoint(.75f, .84f), CurvePoint(1f, 1f))
                    ))
                )
            }
            Regex("(ليليه|ليليه سينمائيه|ليلي سينمائي|night|cinematic blue)").containsMatchIn(part) -> {
                if (state.selectedClipId != null) updateClipColorGrade(
                    ColorGrade(
                        enabled = true,
                        liftR = -.03f, liftG = -.02f, liftB = .01f,
                        gammaR = .96f, gammaG = .99f, gammaB = 1.06f,
                        gainR = .84f, gainG = .92f, gainB = 1.16f,
                        curves = ColorCurves(
                            master = listOf(CurvePoint(0f, .02f), CurvePoint(.5f, .42f), CurvePoint(1f, .94f)),
                            blue = listOf(CurvePoint(0f, .06f), CurvePoint(.5f, .58f), CurvePoint(1f, 1f))
                        )
                    )
                )
            }
            Regex("(قناع|mask)").containsMatchIn(part) -> { addMask(MaskType.ELLIPSE); showMaskEditor() }
            Regex("(انتقال|transition|dissolve|fade)").containsMatchIn(part) -> {
                val id = state.selectedClipId
                if (id != null) setTransition(id, Transition(TransitionType.DISSOLVE, 500L, TransitionEasing.EASE_IN_OUT))
            }
            Regex("(كيفريم|keyframe)").containsMatchIn(part) -> {
                addKeyframe(KeyframeProperty.POSITION_X, playheadMs.value, 0f)
                addKeyframe(KeyframeProperty.POSITION_Y, playheadMs.value, 0f)
            }
            Regex("(نص|title|caption)").containsMatchIn(part) -> {
                val text = part.replaceFirst(Regex("^.*?(?:نص|title|caption)\\s*"), "").trim().ifBlank { "نص جديد" }
                addTextOverlay(TextOverlay(text = text, startTimeMs = playheadMs.value, endTimeMs = playheadMs.value + 3000L, animationIn = TextAnimation.FADE))
            }
            Regex("(اصنع ترجمه|ترجمه تلقائيه|auto caption|captions)").containsMatchIn(part) -> showPanel(PanelId.CAPTION_EDITOR)
            Regex("(مزامنه كاميرات|multi cam|multicam)").containsMatchIn(part) -> showMultiCam()
            Regex("(تعديل طيفي|spectral|spectrogram)").containsMatchIn(part) -> showAudioPanel()
            Regex("(optical flow|تدفق بصري|اعاده توقيت متقدمه|منحنى سرعه)").containsMatchIn(part) -> showSpeedCurveEditor()
            Regex("(تتبع حركه|تتبع الحركة|motion tracking)").containsMatchIn(part) -> showPanel(PanelId.AI_TOOLS)
            Regex("(ازاله ضوضاء|تقليل ضوضاء|noise reduction)").containsMatchIn(part) -> analyzeAndReduceNoise()
            Regex("(ازاله خلفيه|خلفيه|background removal)").containsMatchIn(part) -> showAiToolsPanel()
            Regex("(صوت|audio|volume)").containsMatchIn(part) -> showAudioMixer()
            Regex("(الوان|color|grading)").containsMatchIn(part) -> showColorGrading()
            else -> when {
                part.contains("سرعه") || part.contains("optical") -> showSpeedCurveEditor()
                part.contains("قناع") -> showMaskEditor()
                part.contains("صوت") -> showAudioPanel()
                part.contains("لون") -> showColorGrading()
                else -> showAiToolsPanel()
            }
        }
    }
}
''')

(UI / "AssistantEditorScreen.kt").write_text(r'''package com.novacut.editor.ui.editor

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import kotlinx.coroutines.launch

@Stable
data class AssistantRequest(val id: Long, val text: String)

@Composable
fun AssistantEditorScreen(onBack: () -> Unit, viewModel: EditorViewModel = hiltViewModel()) {
    var request by remember { mutableStateOf<AssistantRequest?>(null) }
    var open by rememberSaveable { mutableStateOf(false) }
    var text by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    Box(Modifier.fillMaxSize()) {
        EditorScreen(onBack = onBack, viewModel = viewModel, assistantCommand = request)
        FloatingActionButton(
            onClick = { open = true },
            modifier = Modifier.align(Alignment.BottomEnd).padding(18.dp),
            containerColor = MaterialTheme.colorScheme.primary
        ) { Icon(Icons.Filled.SmartToy, contentDescription = "مساعد المونتاج") }
        if (open) {
            ModalBottomSheet(onDismissRequest = { open = false }) {
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    Text("مساعد المونتاج", style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(8.dp))
                    Text("نفّذ أوامر بسيطة أو مركبة: قص، حركة كاميرا، منحنى لوني، ليل سينمائي أزرق، نص، قناع، صوت، انتقالات، كيفريمات…", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(value = text, onValueChange = { text = it }, modifier = Modifier.fillMaxWidth(), minLines = 2,
                        trailingIcon = { Icon(Icons.Filled.Mic, contentDescription = "صوت") },
                        placeholder = { Text("مثال: قص عند المؤشر ثم أضف حركة كاميرا واجعل الإضاءة ليلية سينمائية زرقاء") })
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = {
                        val value = text.trim()
                        if (value.isNotEmpty()) { request = AssistantRequest(System.currentTimeMillis(), value); text = ""; scope.launch { kotlinx.coroutines.delay(180); open = false } }
                    }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Filled.Send, contentDescription = null); Spacer(Modifier.width(8.dp)); Text("تنفيذ")
                    }
                    Spacer(Modifier.height(20.dp))
                }
            }
        }
    }
}
''')

editor = UI / "EditorScreen.kt"
e = editor.read_text()
old = "fun EditorScreen(\n    modifier: Modifier = Modifier,\n    onBack: () -> Unit = {},\n    viewModel: EditorViewModel = hiltViewModel()\n) {"
new = "fun EditorScreen(\n    modifier: Modifier = Modifier,\n    onBack: () -> Unit = {},\n    viewModel: EditorViewModel = hiltViewModel(),\n    assistantCommand: AssistantRequest? = null\n) {"
if old not in e:
    raise SystemExit("EditorScreen signature changed upstream; patch not applied")
e = e.replace(old, new, 1)
marker = "    val state by viewModel.state.collectAsStateWithLifecycle()\n"
insert = marker + "    val assistantContext = LocalContext.current\n    LaunchedEffect(assistantCommand?.id) { assistantCommand?.let { request -> viewModel.executeAssistantCommand(assistantContext, request) } }\n"
e = e.replace(marker, insert, 1)
editor.write_text(e)

main = JAVA / "MainActivity.kt"
m = main.read_text()
m = m.replace('import com.novacut.editor.ui.editor.EditorScreen', 'import com.novacut.editor.ui.editor.AssistantEditorScreen')
m = m.replace('EditorScreen(\n', 'AssistantEditorScreen(\n')
main.write_text(m)

(APP / "src/main/assets").mkdir(parents=True, exist_ok=True)
(APP / "src/main/assets/ai_creative_studio_engine.txt").write_text(
    "AI Creative Studio Android build\n"
    "Base: ClearCut MIT (pinned upstream commit ba6d118722b23386567c84bce8442a400713748b)\n"
    "Editor: Kotlin + Jetpack Compose + Media3\n"
    "Assistant: local intent parser + native command executor\n"
    "Heavy engine routing policy: device-aware local/cloud decision\n"
)
print("ClearCut patch applied successfully")
