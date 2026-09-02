from pathlib import Path
import sys

ROOT = Path(sys.argv[1])
main = ROOT / "app/src/main/java/com/novacut/editor/MainActivity.kt"
if not main.exists():
    raise SystemExit("MainActivity.kt not found")
text = main.read_text()
imp = "import com.novacut.editor.ui.editor.VireonLocaleManager\n"
anchor = "import com.novacut.editor.ui.editor.VireonEditorScreen\n"
if anchor in text and imp not in text:
    text = text.replace(anchor, anchor + imp, 1)
needle = "        enableEdgeToEdge()\n"
insert = needle + "        VireonLocaleManager.apply(this)\n"
if needle in text and "VireonLocaleManager.apply(this)" not in text:
    text = text.replace(needle, insert, 1)
old = '                        startDestination = "projects",\n'
new = '                        startDestination = if (intent?.getBooleanExtra("vireon_smoke", false) == true) "editor/tutorial?replayTutorial=true" else "projects",\n'
if old in text:
    text = text.replace(old, new, 1)
main.write_text(text)
print("Vireon locale bootstrap and CI editor launch route wired")
