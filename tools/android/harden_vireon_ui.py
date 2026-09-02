from pathlib import Path

import sys

ROOT=Path(sys.argv[1])
ui=ROOT/'app/src/main/java/com/novacut/editor/ui/editor/VireonEditorScreen.kt'
text=ui.read_text(encoding='utf-8')
# Use the Compose-provided layout direction local; LayoutDirection is the value type.
if 'import androidx.compose.ui.unit.LayoutDirection' not in text:
    text=text.replace('import androidx.compose.ui.unit.dp\n', 'import androidx.compose.ui.unit.dp\nimport androidx.compose.ui.unit.LayoutDirection\n', 1)
if 'import androidx.compose.ui.platform.LocalLayoutDirection' not in text:
    text=text.replace('import androidx.compose.ui.platform.LocalContext\n', 'import androidx.compose.ui.platform.LocalContext\nimport androidx.compose.ui.platform.LocalLayoutDirection\n', 1)
text=text.replace('LocalLayoutDirection provides if (isAr) androidx.compose.ui.unit.LayoutDirection.Rtl else androidx.compose.ui.unit.LayoutDirection.Ltr', 'LocalLayoutDirection provides if (isAr) LayoutDirection.Rtl else LayoutDirection.Ltr')
# Align is a BoxScope modifier extension, so make these overlay components BoxScope composables.
text=text.replace('@Composable private fun VireonRightPanel(', '@Composable private fun BoxScope.VireonRightPanel(')
text=text.replace('@Composable private fun VireonBottomBar(', '@Composable private fun BoxScope.VireonBottomBar(')
ui.write_text(text,encoding='utf-8')
contract=ROOT/'app/src/main/assets/vireon_ui_contract.json'
contract.write_text('''{\n  "product": "Vireon",\n  "ui": "arabic-first-bilingual",\n  "layout": ["top_bar", "left_tool_rail", "center_preview_timeline", "right_property_panel", "bottom_tool_bar"],\n  "languages": ["ar", "en"],\n  "assistant": "vireon-command-int8-v1",\n  "language_behavior": "activity_recreate_and_runtime_locale",\n  "behavior_target": "observable_capcut_style_editing_semantics_without_proprietary_code_or_assets"\n}\n''',encoding='utf-8')
print('Vireon Compose layout hardening applied')
