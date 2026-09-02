from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1])
UI = ROOT / "app/src/main/java/com/novacut/editor/ui/editor"
agent = UI / "VireonArabicCommandAgent.kt"
if not agent.exists():
    raise SystemExit("VireonArabicCommandAgent.kt not found")
text = agent.read_text(encoding='utf-8')
text = re.sub(r'private val executable = setOf\(.*?\n    \)', '''private val executable = setOf(
        "SPLIT", "TRIM", "DELETE_SILENCE", "DENOISE", "DUPLICATE", "SPEED", "CAMERA_MOTION",
        "COLOR_CURVE", "COLOR_GRADE", "CINEMATIC_NIGHT", "MASK", "TRANSITION", "KEYFRAME",
        "TEXT", "CAPTIONS", "MOTION_TRACK", "BACKGROUND_REMOVE", "AUDIO", "ROTATE", "FLIP", "UPSCALE"
    )''', text, count=1, flags=re.S)
agent.write_text(text,encoding='utf-8')

screen=UI/'VireonEditorScreen.kt'
s=screen.read_text(encoding='utf-8')
s=s.replace('@Composable private fun VireonTopBar(isAr: Boolean, onBack:', '@Composable private fun VireonTopBar(isAr: Boolean, viewModel: EditorViewModel, onBack:', 1)
s=s.replace('''VireonTopBar(
                    isAr = isAr,
                    onBack = onBack,''','''VireonTopBar(
                    isAr = isAr,
                    viewModel = viewModel,
                    onBack = onBack,''',1)
s=s.replace('''IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, if (isAr) "رجوع" else "Back") }''','''IconButton(onClick = { viewModel.undo() }) { Icon(Icons.Default.Undo, if (isAr) "تراجع" else "Undo") }
        IconButton(onClick = { viewModel.redo() }) { Icon(Icons.Default.Redo, if (isAr) "إعادة" else "Redo") }
        IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, if (isAr) "رجوع" else "Back") }''',1)
s=s.replace('''Button(onClick = {}, shape = RoundedCornerShape(9.dp),''','''Button(onClick = { viewModel.showExportSheet() }, shape = RoundedCornerShape(9.dp),''',1)
if 'مشروع جديد' not in s and 'New Project' not in s:
    s=s.replace('Text("Vireon", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = VireonText, modifier = Modifier.weight(1f))','Text("Vireon", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = VireonText, modifier = Modifier.weight(1f))\n        TextButton(onClick = {}) { Text(if (isAr) "مشروع جديد" else "New Project") }\n        TextButton(onClick = {}) { Text(if (isAr) "حفظ" else "Save") }',1)
screen.write_text(s,encoding='utf-8')
print('Vireon agent hardened and shell controls wired')
