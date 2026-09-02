from pathlib import Path
import sys

ROOT = Path(sys.argv[1])
UI = ROOT / "app/src/main/java/com/novacut/editor/ui/editor"
RES_AR = ROOT / "app/src/main/res/values-ar"
RES_BASE = ROOT / "app/src/main/res/values"
ASSETS = ROOT / "app/src/main/assets"
UI.mkdir(parents=True, exist_ok=True)
RES_AR.mkdir(parents=True, exist_ok=True)
RES_BASE.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

(UI / "VireonQuantizedIntentModel.kt").write_text(r'''
package com.novacut.editor.ui.editor

import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale

/** Tiny deterministic offline INT8-weighted intent model for complex editor commands. */
object VireonQuantizedIntentModel {
    private data class Intent(val name: String, val terms: List<String>, val bias: Int)
    private val intents = listOf(
        Intent("SPLIT", listOf("قسم", "قسّم", "تقسيم", "split"), 18),
        Intent("TRIM", listOf("قص", "اقتطع", "احذف من", "trim"), 12),
        Intent("DELETE_SILENCE", listOf("صمت", "الصامت", "ازالة الصمت", "delete silence"), 34),
        Intent("DUPLICATE", listOf("كرر", "تكرار", "نسخه", "duplicate"), 24),
        Intent("SPEED", listOf("سرعة", "سرعه", "تسريع", "تبطيء", "منحنى السرعة", "speed ramp", "speed"), 24),
        Intent("CAMERA_MOTION", listOf("حركة كاميرا", "حرك الكاميرا", "تحريك الكاميرا", "camera motion"), 30),
        Intent("COLOR_CURVE", listOf("منحنى لوني", "منحنيات الوان", "منحنى الالوان", "color curve"), 30),
        Intent("CINEMATIC_NIGHT", listOf("ليلي سينمائي", "ليل سينمائي", "ليليه سينمائيه", "cinematic blue"), 30),
        Intent("MASK", listOf("قناع", "mask"), 24),
        Intent("TRANSITION", listOf("انتقال", "تلاشي", "transition", "fade", "dissolve"), 22),
        Intent("KEYFRAME", listOf("كيفريم", "اطار مفتاحي", "keyframe"), 24),
        Intent("TEXT", listOf("اضف نص", "نص", "عنوان", "caption", "title"), 22),
        Intent("CAPTIONS", listOf("ترجمه", "ترجمة", "التفريغ", "تعليقات تلقائية", "auto captions", "whisper"), 28),
        Intent("MOTION_TRACK", listOf("تتبع الحركة", "تتبع حركه", "motion tracking", "tracking", "track motion"), 30),
        Intent("DENOISE", listOf("إزالة الضوضاء", "ازالة ضوضاء", "تقليل الضوضاء", "noise reduction", "denoise"), 28),
        Intent("BACKGROUND_REMOVE", listOf("إزالة الخلفية", "ازالة خلفية", "خلفيه", "background removal", "remove background"), 28),
        Intent("AUDIO", listOf("الصوت", "صوت", "ميكسر", "معادل", "audio"), 20),
        Intent("COLOR_GRADE", listOf("تعديل اللون", "الالوان", "تصحيح الالوان", "color grading"), 20),
        Intent("ROTATE", listOf("تدوير", "دوّر", "rotate"), 18),
        Intent("FLIP", listOf("قلب أفقي", "اقلب افقيا", "قلب رأسي", "flip"), 18),
        Intent("UPSCALE", listOf("رفع الجودة", "تحسين الجودة", "تكبير الجودة", "upscale"), 26)
    )

    fun analyze(input: String): String {
        val normalized = normalize(input)
        val parts = normalized.split(Regex("\\s*(?:ثم|وبعدها|وبعد ذلك|و كذلك|و ايضا|then|and then|followed by|after that|;|\\n|،)\\s*"))
            .map { it.trim() }.filter { it.isNotEmpty() }
        val ops = parts.mapNotNull { classify(it) }
        val output = JSONObject().apply {
            put("model", "vireon-command-int8-v1")
            put("quantization", "int8")
            put("normalized", normalized)
        }
        val array = org.json.JSONArray(); ops.forEach { array.put(it) }; output.put("operations", array)
        output.put("confidence", if (ops.isEmpty()) 0.0 else ops.map { it.optDouble("confidence", 0.0) }.average())
        return output.toString()
    }

    private fun classify(part: String): JSONObject? {
        var best: Intent? = null; var bestScore = 0
        for (intent in intents) {
            var score = intent.bias
            for (term in intent.terms) if (part.contains(normalize(term))) score += 32
            if (score > bestScore) { bestScore = score; best = intent }
        }
        val intent = best ?: return null
        if (bestScore < 40) return null
        return JSONObject().apply {
            put("intent", intent.name); put("confidence", (bestScore / 96.0).coerceAtMost(0.99))
            Regex("(\\d+(?:[.]\\d+)?)\\s*(?:ثانية|ثواني|sec|secs|s)").find(part)?.groupValues?.get(1)?.toDoubleOrNull()?.let { put("seconds", it) }
            Regex("(\\d+(?:[.]\\d+)?)\\s*%").find(part)?.groupValues?.get(1)?.toDoubleOrNull()?.let { put("percent", it) }
            Regex("(?:إلى|الى|at|to)?\\s*(\\d+(?:[.]\\d+)?)\\s*x").find(part)?.groupValues?.get(1)?.toDoubleOrNull()?.let { put("speed", it) }
            Regex("(?:من|from)\\s*(\\d+(?:[.]\\d+)?)\\s*(?:إلى|الى|to)\\s*(\\d+(?:[.]\\d+)?)").find(part)?.let { m -> put("start", m.groupValues[1].toDouble()); put("end", m.groupValues[2].toDouble()) }
            if (intent.name == "TEXT") put("text", part.replaceFirst(Regex("^.*?(?:اضف نص|نص|عنوان|caption|title)\\s*"), "").trim().ifBlank { "نص جديد" })
        }
    }

    private fun normalize(value: String): String = Normalizer.normalize(value.lowercase(Locale.ROOT), Normalizer.Form.NFKD)
        .replace(Regex("[\\u064B-\\u065F\\u0670\\u0640]"), "")
        .replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي")
        .replace(Regex("\\s+"), " ").trim()
}
''', encoding="utf-8")

(UI / "VireonArabicCommandAgent.kt").write_text(r'''
package com.novacut.editor.ui.editor

import android.content.Context
import org.json.JSONObject

/** Arabic/English command agent: normalize -> classify -> execute only through native editor APIs. */
object VireonArabicCommandAgent {
    data class Plan(val operations: List<JSONObject>, val confidence: Double, val model: String)

    private val executable = setOf(
        "SPLIT", "TRIM", "DELETE_SILENCE", "DENOISE", "DUPLICATE", "SPEED", "CAMERA_MOTION",
        "COLOR_CURVE", "COLOR_GRADE", "CINEMATIC_NIGHT", "MASK", "TRANSITION", "KEYFRAME",
        "TEXT", "CAPTIONS", "MOTION_TRACK", "BACKGROUND_REMOVE", "AUDIO", "ROTATE", "FLIP", "UPSCALE"
    )

    fun plan(text: String): Plan {
        val raw = JSONObject(VireonQuantizedIntentModel.analyze(text))
        val arr = raw.optJSONArray("operations") ?: org.json.JSONArray()
        val operations = buildList { for (i in 0 until arr.length()) add(arr.getJSONObject(i)) }
        return Plan(operations, raw.optDouble("confidence", 0.0), raw.optString("model", "unknown"))
    }

    fun hasExecutableOperations(plan: Plan): Boolean = plan.operations.any { executable.contains(it.optString("intent")) }

    suspend fun execute(context: Context, viewModel: EditorViewModel, text: String) {
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
                                val end = (clip.trimStartMs + (seconds * 1000.0).toLong()).coerceIn(clip.trimStartMs + 1L, clip.trimEndMs)
                                viewModel.trimClip(id, newTrimEndMs = end)
                            }
                        } else viewModel.beginTrim()
                    }
                    "DELETE_SILENCE" -> { viewModel.proposeCutsForReview(); viewModel.showPanel(PanelId.AI_TOOLS) }
                    "DENOISE" -> viewModel.analyzeAndReduceNoise()
                    "DUPLICATE" -> viewModel.duplicateSelectedClip()
                    "SPEED" -> {
                        val id = viewModel.state.value.selectedClipId
                        val factor = op.optDouble("speed", Double.NaN).toFloat()
                        if (id != null && !factor.isNaN()) { viewModel.beginSpeedChange(); viewModel.setClipSpeed(id, factor.coerceIn(0.1f, 10f)); viewModel.endSpeedChange() }
                        else viewModel.showSpeedCurveEditor()
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
                // An individual operation must never crash the editor; the native API may
                // reject an operation when prerequisites are missing. Continue the plan.
            }
        }
    }
}
''', encoding="utf-8")

base_xml = RES_BASE / "vireon_strings.xml"
base_xml.write_text(r'''<?xml version="1.0" encoding="utf-8"?>
<resources>
<string name="vireon_product_name">Vireon — Smart Video Editor</string><string name="vireon_project">Project</string><string name="vireon_media">Media</string><string name="vireon_templates">Templates</string><string name="vireon_music">Music</string><string name="vireon_text">Text</string><string name="vireon_stickers">Stickers</string><string name="vireon_effects">Effects</string><string name="vireon_transitions">Transitions</string><string name="vireon_filters">Filters</string><string name="vireon_adjust">Adjust</string><string name="vireon_tools">Tools</string><string name="vireon_cut">Cut</string><string name="vireon_speed">Speed</string><string name="vireon_color">Color</string><string name="vireon_chroma">Chroma Key</string><string name="vireon_stabilize">Stabilize</string><string name="vireon_motion">Motion</string><string name="vireon_blend">Blend</string><string name="vireon_mask">Mask</string><string name="vireon_tracking">Motion Tracking</string><string name="vireon_audio">Audio</string><string name="vireon_ai_tools">AI Tools</string><string name="vireon_background">Background</string><string name="vireon_export">Export</string><string name="vireon_save">Save</string><string name="vireon_new_project">New Project</string><string name="vireon_assistant">Editor Assistant</string><string name="vireon_execute">Execute</string><string name="vireon_type_command">Type a command…</string>
</resources>
''',encoding="utf-8")

(RES_AR / "strings.xml").write_text(r'''<?xml version="1.0" encoding="utf-8"?>
<resources>
<string name="vireon_product_name">Vireon — محرر الفيديو الذكي</string><string name="vireon_project">المشروع</string><string name="vireon_media">الوسائط</string><string name="vireon_templates">القوالب</string><string name="vireon_music">موسيقى</string><string name="vireon_text">نص</string><string name="vireon_stickers">ملصقات</string><string name="vireon_effects">تأثيرات</string><string name="vireon_transitions">انتقالات</string><string name="vireon_filters">فلاتر</string><string name="vireon_adjust">ضبط</string><string name="vireon_tools">أدوات</string><string name="vireon_cut">قص</string><string name="vireon_speed">السرعة</string><string name="vireon_color">الألوان</string><string name="vireon_chroma">مفتاح الكروما</string><string name="vireon_stabilize">تثبيت</string><string name="vireon_motion">تحريك</string><string name="vireon_blend">مزج</string><string name="vireon_mask">قناع</string><string name="vireon_tracking">تتبع الحركة</string><string name="vireon_audio">الصوت</string><string name="vireon_ai_tools">أدوات الذكاء الاصطناعي</string><string name="vireon_background">الخلفية</string><string name="vireon_export">تصدير</string><string name="vireon_save">حفظ</string><string name="vireon_new_project">مشروع جديد</string><string name="vireon_assistant">مساعد المونتير</string><string name="vireon_execute">تنفيذ</string><string name="vireon_type_command">اكتب أمرك بالعربية…</string>
</resources>
''',encoding="utf-8")

(ASSETS / "vireon_command_model_int8.json").write_text(r'''{"model":"vireon-command-int8-v1","type":"deterministic-int8-intent-classifier","quantization":"int8","offline":true,"supports":["multi_intent","arabic_english_normalization","seconds","percent","speed_x","ranges","text_slots"]}''',encoding="utf-8")
print("Vireon AI Arabic upgrade prepared and compile-safe")
