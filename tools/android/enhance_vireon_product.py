from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1])
APP = ROOT / "app"
JAVA = APP / "src/main/java/com/novacut/editor"
UI = JAVA / "ui/editor"
RES_AR = APP / "src/main/res/values-ar"
RES_BASE = APP / "src/main/res/values"
ASSETS = APP / "src/main/assets"
for p in (UI, RES_AR, RES_BASE, ASSETS):
    p.mkdir(parents=True, exist_ok=True)

(UI / "VireonLocaleManager.kt").write_text(r'''package com.novacut.editor.ui.editor

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import java.util.Locale

object VireonLocaleManager {
    private const val PREFS = "vireon_preferences"
    private const val KEY_LANGUAGE = "language"

    fun getLanguage(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LANGUAGE, "ar") ?: "ar"

    fun setLanguage(context: Context, language: String) {
        require(language == "ar" || language == "en")
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_LANGUAGE, language).apply()
        apply(context, language)
    }

    fun apply(context: Context, language: String = getLanguage(context)) {
        val locale = Locale(language)
        Locale.setDefault(locale)
        val resources = context.resources
        val config = Configuration(resources.configuration)
        config.setLocale(locale)
        config.setLayoutDirection(locale)
        @Suppress("DEPRECATION")
        resources.updateConfiguration(config, resources.displayMetrics)
        if (Build.VERSION.SDK_INT >= 24) {
            context.createConfigurationContext(config)
        }
    }

    fun recreate(activity: Activity, language: String) {
        setLanguage(activity, language)
        activity.recreate()
    }
}
''', encoding="utf-8")

(UI / "VireonEditorScreen.kt").write_text(r'''package com.novacut.editor.ui.editor

import android.app.Activity
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import kotlinx.coroutines.launch

private val VireonBg = Color(0xFF090A10)
private val VireonPanel = Color(0xFF11131C)
private val VireonPanel2 = Color(0xFF171A26)
private val VireonPurple = Color(0xFF8B5CF6)
private val VireonPurple2 = Color(0xFF6D3DF3)
private val VireonText = Color(0xFFF5F3FF)
private val VireonMuted = Color(0xFFAAA8B8)

private data class VireonTool(val id: String, val ar: String, val en: String, val icon: @Composable () -> Unit, val action: (EditorViewModel) -> Unit)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VireonEditorScreen(
    onBack: () -> Unit = {},
    viewModel: EditorViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    var language by remember { mutableStateOf(VireonLocaleManager.getLanguage(context)) }
    var showSettings by rememberSaveable { mutableStateOf(false) }
    var showAssistant by rememberSaveable { mutableStateOf(false) }
    var assistantText by rememberSaveable { mutableStateOf("") }
    var activeTool by rememberSaveable { mutableStateOf("cut") }
    val scope = rememberCoroutineScope()
    val isAr = language == "ar"

    LaunchedEffect(language) { VireonLocaleManager.apply(context, language) }
    BackHandler(onBack = onBack)

    val tools = remember(isAr) {
        listOf(
            VireonTool("cut", "القص", "Cut", { Icon(Icons.Default.ContentCut, null) }) { vm -> vm.showPanel(PanelId.CROP) },
            VireonTool("speed", "السرعة", "Speed", { Icon(Icons.Default.Speed, null) }) { vm -> vm.showSpeedCurveEditor() },
            VireonTool("transition", "انتقال", "Transition", { Icon(Icons.Default.AutoAwesomeMotion, null) }) { vm -> vm.showPanel(PanelId.TRANSITION_PICKER) },
            VireonTool("filter", "فلتر", "Filter", { Icon(Icons.Default.Filter, null) }) { vm -> vm.showPanel(PanelId.EFFECTS) },
            VireonTool("color", "تعديل اللون", "Color", { Icon(Icons.Default.Tune, null) }) { vm -> vm.showColorGrading() },
            VireonTool("effects", "تأثيرات", "Effects", { Icon(Icons.Default.AutoFixHigh, null) }) { vm -> vm.showPanel(PanelId.EFFECTS) },
            VireonTool("chroma", "كروما", "Chroma", { Icon(Icons.Default.Layers, null) }) { vm -> vm.showPanel(PanelId.CHROMA_KEY) },
            VireonTool("stabilize", "تثبيت", "Stabilize", { Icon(Icons.Default.Shield, null) }) { vm -> vm.showPanel(PanelId.AI_TOOLS) },
            VireonTool("motion", "تحريك", "Motion", { Icon(Icons.Default.OpenWith, null) }) { vm -> vm.showTransformPanel() },
            VireonTool("blend", "مزج", "Blend", { Icon(Icons.Default.LayersClear, null) }) { vm -> vm.showPanel(PanelId.BLEND_MODE) },
            VireonTool("mask", "قناع", "Mask", { Icon(Icons.Default.Circle, null) }) { vm -> vm.showMaskEditor() },
            VireonTool("tracking", "تتبع الحركة", "Tracking", { Icon(Icons.Default.TrackChanges, null) }) { vm -> vm.showPanel(PanelId.AI_TOOLS) },
        )
    }

    MaterialTheme(colorScheme = darkColorScheme(
        background = VireonBg,
        surface = VireonPanel,
        surfaceVariant = VireonPanel2,
        primary = VireonPurple,
        secondary = VireonPurple2,
        onBackground = VireonText,
        onSurface = VireonText,
        onSurfaceVariant = VireonMuted,
    )) {
        CompositionLocalProvider(LocalLayoutDirection provides if (isAr) androidx.compose.ui.unit.LayoutDirection.Rtl else androidx.compose.ui.unit.LayoutDirection.Ltr) {
            Box(Modifier.fillMaxSize().background(VireonBg)) {
                // Keep the proven native editor renderer/timeline as the functional core.
                // The Vireon shell owns the visible chrome so the old editor chrome is not the primary UI.
                EditorScreen(
                    onBack = onBack,
                    viewModel = viewModel,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(top = 58.dp, start = 74.dp, end = 252.dp, bottom = 148.dp)
                )

                VireonTopBar(
                    isAr = isAr,
                    onBack = onBack,
                    onAssistant = { showAssistant = true },
                    onSettings = { showSettings = true },
                )
                VireonLeftRail(
                    isAr = isAr,
                    tools = tools,
                    activeTool = activeTool,
                    onTool = { tool ->
                        activeTool = tool.id
                        tool.action(viewModel)
                    }
                )
                VireonRightPanel(isAr = isAr, activeTool = activeTool, onAssistant = { showAssistant = true })
                VireonBottomBar(
                    isAr = isAr,
                    tools = tools,
                    activeTool = activeTool,
                    onTool = { tool ->
                        activeTool = tool.id
                        tool.action(viewModel)
                    },
                    onAssistant = { showAssistant = true }
                )

                if (showAssistant) {
                    VireonAssistantSheet(
                        isAr = isAr,
                        text = assistantText,
                        onText = { assistantText = it },
                        onDismiss = { showAssistant = false },
                        onRun = {
                            val command = assistantText.trim()
                            if (command.isNotEmpty()) {
                                scope.launch {
                                    viewModel.executeAssistantCommand(context, AssistantRequest(System.currentTimeMillis(), command))
                                    showAssistant = false
                                    assistantText = ""
                                }
                            }
                        }
                    )
                }
                if (showSettings) {
                    VireonSettingsSheet(
                        currentLanguage = language,
                        onDismiss = { showSettings = false },
                        onLanguage = { selected ->
                            language = selected
                            val activity = context as? Activity
                            if (activity != null) VireonLocaleManager.recreate(activity, selected)
                            else VireonLocaleManager.setLanguage(context, selected)
                        }
                    )
                }
            }
        }
    }
}

@Composable private fun VireonTopBar(isAr: Boolean, onBack: () -> Unit, onAssistant: () -> Unit, onSettings: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(58.dp).background(VireonPanel).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("V", fontSize = 25.sp, fontWeight = FontWeight.Black, color = VireonPurple, modifier = Modifier.padding(horizontal = 10.dp))
        Text("Vireon", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = VireonText, modifier = Modifier.weight(1f))
        IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, if (isAr) "رجوع" else "Back") }
        IconButton(onClick = onAssistant) { Icon(Icons.Default.SmartToy, if (isAr) "مساعد المونتاج" else "Editor assistant") }
        IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, if (isAr) "الإعدادات" else "Settings") }
        AssistChip(onClick = {}, label = { Text("1080P") })
        Spacer(Modifier.width(8.dp))
        Button(onClick = {}, shape = RoundedCornerShape(9.dp), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 7.dp)) {
            Text(if (isAr) "تصدير" else "Export", fontWeight = FontWeight.Bold)
        }
    }
}

@Composable private fun VireonLeftRail(isAr: Boolean, tools: List<VireonTool>, activeTool: String, onTool: (VireonTool) -> Unit) {
    Surface(Modifier.fillMaxHeight().width(74.dp).padding(top = 58.dp, bottom = 148.dp), color = VireonPanel) {
        LazyColumn(Modifier.fillMaxSize().padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            item { RailButton("media", if (isAr) "الوسائط" else "Media", Icons.Default.VideoLibrary, activeTool == "media") { } }
            item { RailButton("templates", if (isAr) "القوالب" else "Templates", Icons.Default.GridView, false) { } }
            item { RailButton("music", if (isAr) "موسيقى" else "Music", Icons.Default.MusicNote, false) { } }
            item { RailButton("text", if (isAr) "نص" else "Text", Icons.Default.TextFields, false) { } }
            item { RailButton("stickers", if (isAr) "ملصقات" else "Stickers", Icons.Default.EmojiEmotions, false) { } }
            item { RailButton("effects", if (isAr) "تأثيرات" else "Effects", Icons.Default.AutoFixHigh, activeTool == "effects") { tools.first { it.id == "effects" }.let(onTool) } }
            item { RailButton("transitions", if (isAr) "انتقالات" else "Transitions", Icons.Default.AutoAwesomeMotion, activeTool == "transition") { tools.first { it.id == "transition" }.let(onTool) } }
            item { RailButton("filters", if (isAr) "فلاتر" else "Filters", Icons.Default.Filter, activeTool == "filter") { tools.first { it.id == "filter" }.let(onTool) } }
            item { RailButton("adjust", if (isAr) "ضبط" else "Adjust", Icons.Default.Tune, activeTool == "color") { tools.first { it.id == "color" }.let(onTool) } }
            item { RailButton("tools", if (isAr) "أدوات" else "Tools", Icons.Default.Build, false) { } }
        }
    }
}

@Composable private fun RailButton(id: String, label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, selected: Boolean, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 5.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(shape = RoundedCornerShape(10.dp), color = if (selected) VireonPurple.copy(alpha = .22f) else Color.Transparent) {
            Icon(icon, null, Modifier.padding(8.dp), tint = if (selected) VireonPurple else VireonMuted)
        }
        Text(label, fontSize = 10.sp, color = if (selected) VireonText else VireonMuted, maxLines = 1)
    }
}

@Composable private fun VireonRightPanel(isAr: Boolean, activeTool: String, onAssistant: () -> Unit) {
    Surface(Modifier.fillMaxHeight().width(252.dp).align(Alignment.CenterEnd).padding(top = 58.dp, bottom = 148.dp), color = VireonPanel) {
        LazyColumn(Modifier.fillMaxSize().padding(12.dp)) {
            item { Text(if (isAr) "الصوت" else "Audio", fontSize = 13.sp, fontWeight = FontWeight.Bold) }
            item { Spacer(Modifier.height(8.dp)); Slider(value = 0.75f, onValueChange = {}, valueRange = 0f..1f) }
            item { Text(if (isAr) "مستوى الصوت 75%" else "Volume 75%", fontSize = 11.sp, color = VireonMuted) }
            item { Spacer(Modifier.height(10.dp)); Divider() }
            item { Text(if (isAr) "معالجة الصوت" else "Audio processing", fontWeight = FontWeight.SemiBold) }
            item { OutlinedButton(onClick = {}, Modifier.fillMaxWidth()) { Text(if (isAr) "تقليل الضوضاء" else "Noise reduction") } }
            item { OutlinedButton(onClick = {}, Modifier.fillMaxWidth()) { Text(if (isAr) "تعزيز الصوت بالذكاء الاصطناعي" else "AI enhance") } }
            item { Spacer(Modifier.height(8.dp)); Divider() }
            item { Text(if (isAr) "الأداة النشطة: $activeTool" else "Active tool: $activeTool", color = VireonMuted, fontSize = 11.sp) }
            item { Spacer(Modifier.height(8.dp)); Button(onClick = onAssistant, Modifier.fillMaxWidth()) { Icon(Icons.Default.SmartToy, null); Spacer(Modifier.width(6.dp)); Text(if (isAr) "أوامر المساعد" else "Assistant commands") } }
        }
    }
}

@Composable private fun VireonBottomBar(isAr: Boolean, tools: List<VireonTool>, activeTool: String, onTool: (VireonTool) -> Unit, onAssistant: () -> Unit) {
    Surface(Modifier.fillMaxWidth().height(148.dp).align(Alignment.BottomCenter), color = VireonPanel2) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().height(92.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                tools.forEach { tool ->
                    Column(Modifier.weight(1f).clickable { onTool(tool) }.padding(horizontal = 2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Surface(shape = RoundedCornerShape(9.dp), color = if (tool.id == activeTool) VireonPurple.copy(alpha = .25f) else Color.Transparent) {
                            Box(Modifier.padding(5.dp)) { tool.icon() }
                        }
                        Text(if (isAr) tool.ar else tool.en, fontSize = 9.sp, color = if (tool.id == activeTool) VireonText else VireonMuted)
                    }
                }
                IconButton(onClick = onAssistant) { Icon(Icons.Default.SmartToy, if (isAr) "مساعد" else "Assistant", tint = VireonPurple) }
            }
            Row(Modifier.fillMaxWidth().height(56.dp).background(VireonBg), verticalAlignment = Alignment.CenterVertically) {
                Text("00:00:00:00", fontSize = 11.sp, color = VireonMuted, modifier = Modifier.padding(horizontal = 12.dp))
                Spacer(Modifier.weight(1f))
                Text("9:16", fontSize = 11.sp, color = VireonMuted, modifier = Modifier.padding(horizontal = 12.dp))
                Text("•", color = VireonPurple, modifier = Modifier.padding(horizontal = 3.dp))
                Text(if (isAr) "مسار الفيديو 1" else "Video 1", fontSize = 11.sp, color = VireonMuted, modifier = Modifier.padding(horizontal = 8.dp))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun VireonAssistantSheet(isAr: Boolean, text: String, onText: (String) -> Unit, onDismiss: () -> Unit, onRun: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = VireonPanel) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(if (isAr) "مساعد المونتاج الذكي" else "AI Editing Assistant", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(if (isAr) "اكتب أمرًا واحدًا أو سلسلة أوامر؛ الوكيل يمر عبر نموذج INT8 محلي ثم ينفذ عبر محركات التحرير الأصلية." else "Enter one command or a multi-step command. The local INT8 agent routes it to the native editor engines.", color = VireonMuted, fontSize = 12.sp)
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(value = text, onValueChange = onText, Modifier.fillMaxWidth().semantics { contentDescription = if (isAr) "حقل أوامر المساعد" else "Assistant command field" }, minLines = 3, placeholder = { Text(if (isAr) "مثال: قص عند المؤشر ثم أضف حركة كاميرا واجعل اللون ليليًا سينمائيًا" else "Example: split at playhead, add camera motion, cinematic night grade") })
            Spacer(Modifier.height(10.dp))
            Button(onClick = onRun, Modifier.fillMaxWidth()) { Icon(Icons.AutoMirrored.Filled.Send, null); Spacer(Modifier.width(6.dp)); Text(if (isAr) "تنفيذ" else "Execute") }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun VireonSettingsSheet(currentLanguage: String, onDismiss: () -> Unit, onLanguage: (String) -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = VireonPanel) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(if (currentLanguage == "ar") "الإعدادات" else "Settings", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Text(if (currentLanguage == "ar") "اللغة" else "Language", fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = currentLanguage == "ar", onClick = { onLanguage("ar") }, label = { Text("العربية") })
                FilterChip(selected = currentLanguage == "en", onClick = { onLanguage("en") }, label = { Text("English") })
            }
            Spacer(Modifier.height(8.dp))
            Text(if (currentLanguage == "ar") "تغيير اللغة يعيد تهيئة التطبيق ويطبق اتجاه الكتابة الصحيح." else "Language changes recreate the app and apply the proper text direction.", color = VireonMuted, fontSize = 12.sp)
            Spacer(Modifier.height(24.dp))
        }
    }
}
''', encoding="utf-8")

# Make the generated Vireon editor the visible editor destination after the existing product integration patch.
main = JAVA / "MainActivity.kt"
if not main.exists():
    raise SystemExit("MainActivity.kt not found")
text = main.read_text()
text = text.replace("import com.novacut.editor.ui.editor.AssistantEditorScreen", "import com.novacut.editor.ui.editor.VireonEditorScreen")
text = text.replace("AssistantEditorScreen(\n", "VireonEditorScreen(\n")
main.write_text(text)

# Default to Arabic while retaining a fully supported English resource set for the Vireon shell.
base = RES_BASE / "vireon_language_defaults.xml"
base.write_text(r'''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="vireon_lang_ar">العربية</string>
    <string name="vireon_lang_en">English</string>
</resources>
''', encoding="utf-8")

ar = RES_AR / "vireon_language.xml"
ar.write_text(r'''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="vireon_lang_ar">العربية</string>
    <string name="vireon_lang_en">English</string>
</resources>
''', encoding="utf-8")

ASSETS.joinpath("vireon_ui_contract.json").write_text(r'''{
  "product": "Vireon",
  "ui": "arabic-first-bilingual",
  "layout": ["top_bar", "left_tool_rail", "center_preview_timeline", "right_property_panel", "bottom_tool_bar"],
  "languages": ["ar", "en"],
  "assistant": "vireon-command-int8-v1",
  "behavior_target": "observable_capcut_style_editing_semantics_without_proprietary_code_or_assets"
}
''', encoding="utf-8")

# Verify that the expected main entry point was redirected.
check = main.read_text()
if "VireonEditorScreen" not in check:
    raise SystemExit("VireonEditorScreen was not wired into MainActivity")
print("Vireon shell, bilingual language manager, and editor entry-point upgrade prepared")
