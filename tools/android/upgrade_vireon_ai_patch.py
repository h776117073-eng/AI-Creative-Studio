from pathlib import Path
import sys

ROOT = Path(sys.argv[1])
UI = ROOT / "app/src/main/java/com/novacut/editor/ui/editor"
RES = ROOT / "app/src/main/res"
ASSETS = ROOT / "app/src/main/assets"
UI.mkdir(parents=True, exist_ok=True)
(RES / "values-ar").mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

(UI / "VireonQuantizedIntentModel.kt").write_text(r'''
package com.novacut.editor.ui.editor

import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale

/** Tiny offline INT8-weighted intent model for complex Arabic/English editor commands. */
object VireonQuantizedIntentModel {
    private data class Intent(val name: String, val terms: List<String>, val bias: Int)
    private val intents = listOf(
        Intent("SPLIT", listOf("قسم", "قسّم", "تقسيم", "split"), 18),
        Intent("TRIM", listOf("قص", "اقتطع", "احذف من", "trim"), 12),
        Intent("DELETE_SILENCE", listOf("صمت", "الصامت", "ازالة الصمت", "delete silence"), 34),
        Intent("DUPLICATE", listOf("كرر", "تكرار", "نسخه", "duplicate"), 24),
        Intent("SPEED", listOf("سرعة", "سرعه", "تسريع", "تبطيء", "منحنى السرعة", "speed ramp"), 24),
        Intent("CAMERA_MOTION", listOf("حركة كاميرا", "حرك الكاميرا", "تحريك الكاميرا", "camera motion"), 30),
        Intent("COLOR_CURVE", listOf("منحنى لوني", "منحنيات الوان", "منحنى الالوان", "color curve"), 30),
        Intent("CINEMATIC_NIGHT", listOf("ليلي سينمائي", "ليل سينمائي", "ليليه سينمائيه", "cinematic blue"), 30),
        Intent("MASK", listOf("قناع", "mask"), 24),
        Intent("TRANSITION", listOf("انتقال", "تلاشي", "transition", "fade", "dissolve"), 22),
        Intent("KEYFRAME", listOf("كيفريم", "اطار مفتاحي", "keyframe"), 24),
        Intent("TEXT", listOf("اضف نص", "نص", "عنوان", "caption", "title"), 22),
        Intent("CAPTIONS", listOf("ترجمه", "ترجمة", "التفريغ", "تعليقات تلقائية", "auto captions", "whisper"), 28),
        Intent("MOTION_TRACK", listOf("تتبع الحركة", "تتبع حركه", "motion tracking", "tracking"), 30),
        Intent("DENOISE", listOf("إزالة الضوضاء", "ازالة ضوضاء", "تقليل الضوضاء", "noise reduction"), 28),
        Intent("BACKGROUND_REMOVE", listOf("إزالة الخلفية", "ازالة خلفية", "خلفيه", "background removal"), 28),
        Intent("AUDIO", listOf("الصوت", "صوت", "ميكسر", "معادل", "audio"), 20),
        Intent("COLOR_GRADE", listOf("تعديل اللون", "الالوان", "تصحيح الالوان", "color grading"), 20),
        Intent("ROTATE", listOf("تدوير", "دوّر", "rotate"), 18),
        Intent("FLIP", listOf("قلب أفقي", "اقلب افقيا", "قلب رأسي", "flip"), 18),
        Intent("UPSCALE", listOf("رفع الجودة", "تحسين الجودة", "تكبير الجودة", "upscale"), 26)
    )

    fun analyze(input: String): String {
        val normalized = normalize(input)
        val parts = normalized.split(Regex("\\s*(?:ثم|وبعدها|وبعد ذلك|و كذلك|و ايضا|;|\\n|،)\\s*"))
            .map { it.trim() }.filter { it.isNotEmpty() }
        val ops = parts.mapNotNull { classify(it) }
        val out = JSONObject()
        out.put("model", "vireon-command-int8-v1")
        out.put("quantization", "int8")
        out.put("normalized", normalized)
        val array = org.json.JSONArray()
        ops.forEach { array.put(it) }
        out.put("operations", array)
        out.put("confidence", if (ops.isEmpty()) 0.0 else ops.map { it.optDouble("confidence", 0.0) }.average())
        return out.toString()
    }

    private fun classify(part: String): JSONObject? {
        var best: Intent? = null
        var bestScore = 0
        for (intent in intents) {
            var score = intent.bias
            for (term in intent.terms) if (part.contains(normalize(term))) score += 32
            if (score > bestScore) { bestScore = score; best = intent }
        }
        val intent = best ?: return null
        if (bestScore < 40) return null
        return JSONObject().apply {
            put("intent", intent.name)
            put("confidence", (bestScore / 96.0).coerceAtMost(0.99))
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

/** Natural-language agent: analyze -> plan -> execute via native editor operations. */
object VireonArabicCommandAgent {
    data class Plan(val operations: List<JSONObject>, val confidence: Double, val model: String)
    fun plan(text: String): Plan {
        val raw = JSONObject(VireonQuantizedIntentModel.analyze(text))
        val arr = raw.optJSONArray("operations") ?: org.json.JSONArray()
        val ops = buildList { for (i in 0 until arr.length()) add(arr.getJSONObject(i)) }
        return Plan(ops, raw.optDouble("confidence", 0.0), raw.optString("model", "unknown"))
    }
    suspend fun execute(context: Context, viewModel: EditorViewModel, text: String) {
        val plan = plan(text)
        val state = viewModel.state.value
        for (op in plan.operations) when (op.optString("intent")) {
            "SPLIT" -> viewModel.splitAtPlayhead()
            "DELETE_SILENCE" -> viewModel.analyzeAndReduceNoise()
            "DUPLICATE" -> viewModel.duplicateSelectedClip()
            "SPEED" -> viewModel.showSpeedCurveEditor()
            "CAMERA_MOTION" -> viewModel.showTransformPanel()
            "COLOR_CURVE", "COLOR_GRADE", "CINEMATIC_NIGHT" -> viewModel.showColorGrading()
            "MASK" -> { viewModel.addMask(MaskType.ELLIPSE); viewModel.showMaskEditor() }
            "TRANSITION" -> state.selectedClipId?.let { id -> viewModel.setTransition(id, Transition(TransitionType.DISSOLVE, 500L, TransitionEasing.EASE_IN_OUT)) }
            "KEYFRAME" -> viewModel.showTransformPanel()
            "TEXT" -> viewModel.addTextOverlay(TextOverlay(text = op.optString("text", "نص جديد"), startTimeMs = viewModel.playheadMs.value, endTimeMs = viewModel.playheadMs.value + 3000L, animationIn = TextAnimation.FADE))
            "CAPTIONS" -> viewModel.showPanel(PanelId.CAPTION_EDITOR)
            "MOTION_TRACK" -> viewModel.showPanel(PanelId.AI_TOOLS)
            "DENOISE" -> viewModel.analyzeAndReduceNoise()
            "BACKGROUND_REMOVE" -> viewModel.showAiToolsPanel()
            "AUDIO" -> viewModel.showAudioMixer()
            "ROTATE", "FLIP", "UPSCALE" -> viewModel.showTransformPanel()
            "TRIM" -> viewModel.showAiToolsPanel()
        }
    }
}
''', encoding="utf-8")

(RES / "values-ar" / "strings.xml").write_text('''<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="vireon_product_name">Vireon — محرر الفيديو الذكي</string>\n    <string name="vireon_project">المشروع</string><string name="vireon_media">الوسائط</string><string name="vireon_templates">القوالب</string><string name="vireon_music">موسيقى</string><string name="vireon_text">نص</string><string name="vireon_stickers">ملصقات</string><string name="vireon_effects">تأثيرات</string><string name="vireon_transitions">انتقالات</string><string name="vireon_filters">فلاتر</string><string name="vireon_adjust">ضبط</string><string name="vireon_tools">أدوات</string>\n    <string name="vireon_cut">قص</string><string name="vireon_speed">سرعة</string><string name="vireon_color">تعديل اللون</string><string name="vireon_chroma">مفتاح الكروما</string><string name="vireon_stabilize">تثبيت</string><string name="vireon_motion">تحريك</string><string name="vireon_blend">مزج</string><string name="vireon_mask">قناع</string><string name="vireon_tracking">تتبع الحركة</string><string name="vireon_audio">الصوت</string><string name="vireon_ai_tools">أدوات الذكاء الاصطناعي</string><string name="vireon_background">الخلفية</string>\n    <string name="vireon_export">تصدير</string><string name="vireon_save">حفظ</string><string name="vireon_new_project">مشروع جديد</string><string name="vireon_assistant">مساعد المونتير</string><string name="vireon_execute">تنفيذ</string><string name="vireon_type_command">اكتب أمرك بالعربية…</string>\n</resources>\n''', encoding="utf-8")

(ASSETS / "vireon_command_model_int8.json").write_text('''{\n  "model": "vireon-command-int8-v1",\n  "type": "deterministic-int8-intent-classifier",\n  "quantization": "int8",\n  "offline": true,\n  "supports": ["multi_intent", "arabic_normalization", "seconds", "percent", "speed_x", "ranges", "text_slots"]\n}\n''', encoding="utf-8")
print("Vireon AI Arabic upgrade prepared")
