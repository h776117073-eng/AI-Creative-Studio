from pathlib import Path
import sys

ROOT=Path(sys.argv[1])
ui=ROOT/'app/src/main/java/com/novacut/editor/ui/editor/VireonEditorScreen.kt'
text=ui.read_text(encoding='utf-8')
if 'import androidx.compose.ui.unit.LayoutDirection' not in text:
    text=text.replace('import androidx.compose.ui.unit.dp\n', 'import androidx.compose.ui.unit.dp\nimport androidx.compose.ui.unit.LayoutDirection\n', 1)
if 'import androidx.compose.ui.platform.LocalLayoutDirection' not in text:
    text=text.replace('import androidx.compose.ui.platform.LocalContext\n', 'import androidx.compose.ui.platform.LocalContext\nimport androidx.compose.ui.platform.LocalLayoutDirection\n', 1)
text=text.replace('LocalLayoutDirection provides if (isAr) androidx.compose.ui.unit.LayoutDirection.Rtl else androidx.compose.ui.unit.LayoutDirection.Ltr', 'LocalLayoutDirection provides if (isAr) LayoutDirection.Rtl else LayoutDirection.Ltr')
text=text.replace('@Composable private fun VireonRightPanel(', '@Composable private fun BoxScope.VireonRightPanel(')
text=text.replace('@Composable private fun VireonBottomBar(', '@Composable private fun BoxScope.VireonBottomBar(')
ui.write_text(text,encoding='utf-8')
contract=ROOT/'app/src/main/assets/vireon_ui_contract.json'
contract.write_text('''{\n  "product": "Vireon",\n  "ui": "arabic-first-bilingual",\n  "layout": ["top_bar", "left_tool_rail", "center_preview_timeline", "right_property_panel", "bottom_tool_bar"],\n  "languages": ["ar", "en"],\n  "assistant": "vireon-command-int8-v1",\n  "language_behavior": "activity_recreate_and_runtime_locale",\n  "behavior_target": "observable_capcut_style_editing_semantics_without_proprietary_code_or_assets"\n}\n''',encoding='utf-8')

test_dir=ROOT/'app/src/test/java/com/novacut/editor'
test_dir.mkdir(parents=True, exist_ok=True)
(test_dir/'VireonProductContractTest.kt').write_text(r'''package com.novacut.editor

import com.novacut.editor.ui.editor.VireonQuantizedIntentModel
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VireonProductContractTest {
    @Test
    fun arabicAndEnglishCommandsProduceEquivalentIntentPlans() {
        val ar=JSONObject(VireonQuantizedIntentModel.analyze("قسّم عند المؤشر ثم السرعة 2x"))
        val en=JSONObject(VireonQuantizedIntentModel.analyze("split at playhead then speed 2x"))
        val arOps=ar.getJSONArray("operations")
        val enOps=en.getJSONArray("operations")
        assertTrue(arOps.length() >= 2)
        assertTrue(enOps.length() >= 2)
        assertEquals("SPLIT", arOps.getJSONObject(0).getString("intent"))
        assertEquals("SPEED", arOps.getJSONObject(1).getString("intent"))
        assertEquals("SPLIT", enOps.getJSONObject(0).getString("intent"))
        assertEquals("SPEED", enOps.getJSONObject(1).getString("intent"))
        assertTrue(ar.getDouble("confidence") >= 0.42)
        assertTrue(en.getDouble("confidence") >= 0.42)
    }

    @Test
    fun complexArabicIntentExtractionKeepsParameters() {
        val result=JSONObject(VireonQuantizedIntentModel.analyze("قسّم من 10 إلى 20 ثم سرعة 1.5x"))
        val ops=result.getJSONArray("operations")
        assertTrue(ops.length() >= 2)
        val split=ops.getJSONObject(0)
        val speed=ops.getJSONObject(1)
        assertEquals("SPLIT", split.getString("intent"))
        assertEquals(10.0, split.getDouble("start"), 0.001)
        assertEquals(20.0, split.getDouble("end"), 0.001)
        assertEquals("SPEED", speed.getString("intent"))
        assertEquals(1.5, speed.getDouble("speed"), 0.001)
    }

    @Test
    fun nonsenseDoesNotBecomeExecutableIntent() {
        val result=JSONObject(VireonQuantizedIntentModel.analyze("asdf qwer zxcv"))
        assertEquals(0, result.getJSONArray("operations").length())
        assertEquals(0.0, result.getDouble("confidence"), 0.001)
    }
}
''',encoding='utf-8')
print('Vireon Compose layout hardening and product contract tests applied')
